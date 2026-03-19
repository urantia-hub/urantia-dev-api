import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { problemJson } from "../lib/errors.ts";

export type AuthUser = {
	id: string;
	email: string | null;
	name: string | null;
	avatarUrl: string | null;
};

declare module "hono" {
	interface ContextVariableMap {
		user: AuthUser | null;
	}
}

// Routes that require a valid JWT
const AUTH_REQUIRED_PREFIXES = ["/me", "/auth"];
// Auth infra routes that don't require a user token
const AUTH_PUBLIC_PATHS = new Set(["/.well-known/openid-configuration", "/.well-known/jwks.json"]);

// Cache the JWKS keyset per Supabase URL to avoid re-fetching on every request
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(supabaseUrl: string) {
	let jwks = jwksCache.get(supabaseUrl);
	if (!jwks) {
		const jwksUrl = new URL("/auth/v1/.well-known/jwks.json", supabaseUrl);
		jwks = createRemoteJWKSet(jwksUrl);
		jwksCache.set(supabaseUrl, jwks);
	}
	return jwks;
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
	// Default: no user
	c.set("user", null);

	const path = c.req.path;

	// Skip auth for public well-known paths
	if (AUTH_PUBLIC_PATHS.has(path)) {
		return next();
	}

	// Check if this route requires auth
	const requiresAuth = AUTH_REQUIRED_PREFIXES.some((prefix) => path.startsWith(prefix));

	// Extract token from Authorization header
	const authHeader = c.req.header("authorization");
	const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

	// If route requires auth but no token provided
	if (requiresAuth && !token) {
		return problemJson(c, 401, "Authentication required. Provide a valid Bearer token.");
	}

	// If no token and route doesn't require auth, pass through
	if (!token) {
		return next();
	}

	// Verify the JWT
	const supabaseUrl = c.env?.SUPABASE_URL ?? process.env.SUPABASE_URL;
	if (!supabaseUrl) {
		c.get("logger")?.error("SUPABASE_URL not configured");
		if (requiresAuth) {
			return problemJson(c, 401, "Authentication service not configured.");
		}
		return next();
	}

	try {
		const jwks = getJwks(supabaseUrl);
		const { payload } = await jwtVerify(token, jwks, {
			issuer: `${supabaseUrl}/auth/v1`,
			audience: "authenticated",
		});

		const userId = payload.sub;
		if (!userId) {
			return problemJson(c, 401, "Invalid token: missing subject.");
		}

		// Extract user info from JWT claims
		const email = (payload.email as string) ?? null;
		const userMetadata = (payload.user_metadata as Record<string, unknown>) ?? {};
		const name = (userMetadata.full_name as string) ?? (userMetadata.name as string) ?? null;
		const avatarUrl =
			(userMetadata.avatar_url as string) ?? (userMetadata.picture as string) ?? null;

		// Lazy user creation: ensure user exists in our DB
		const { db } = getDb(c.env?.HYPERDRIVE);
		const existing = await db.select().from(users).where(eq(users.id, userId)).limit(1);

		if (existing.length === 0) {
			await db.insert(users).values({
				id: userId,
				email,
				name,
				avatarUrl,
			});
		}

		c.set("user", { id: userId, email, name, avatarUrl });
	} catch (err) {
		const logger = c.get("logger");
		if (err instanceof Error) {
			// jose throws specific error types for expired, invalid, etc.
			if (err.message.includes("expired")) {
				return problemJson(c, 401, "Token has expired.");
			}
			logger?.warn("JWT verification failed", { error: err.message });
		}
		return problemJson(c, 401, "Invalid or expired token.");
	}

	return next();
};
