import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getDb } from "../db/client.ts";
import { apps, users } from "../db/schema.ts";
import { consentNow, createUserRow, isDeleted } from "../lib/account-store.ts";
import { canUseApp, isAppStatus } from "../lib/app-status.ts";
import { tokenEnv, verifyAccessToken } from "../lib/app-tokens.ts";
import { deletedAccountAllows } from "../lib/consents.ts";
import { problemJson } from "../lib/errors.ts";
import {
	appTokenProblem,
	firstPartyOnly,
	isFirstPartyApp,
	liveTokenProblem,
} from "../lib/token-access.ts";

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
// Auth routes that are public (no JWT required)
const AUTH_PUBLIC_POSTS = new Set(["/auth/token", "/auth/refresh", "/auth/revoke"]);
// The public record of an app and its logo. A change to an app needs a sign-in.
const AUTH_PUBLIC_APP_GET = /^\/auth\/apps\/[^/]+(\/logo(\/[^/]+)?)?$/;

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

	// Check if this is a public auth endpoint (no JWT needed)
	const isPublicAuthPath =
		AUTH_PUBLIC_POSTS.has(path) || (c.req.method === "GET" && AUTH_PUBLIC_APP_GET.test(path));

	// Check if this route requires auth
	const requiresAuth =
		!isPublicAuthPath &&
		AUTH_REQUIRED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

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

	// What the token says about the reader. Only a bad or old token answers 401.
	let reader: AuthUser;
	// The app of an app token. Null for a session token of the accounts site.
	let tokenAppId: string | null = null;
	let tokenScopes: string[] = [];
	try {
		let payload: Record<string, unknown>;
		let fromApp = false;

		// Try Supabase JWKS first (ECC P-256), then our own key for an app token (ES256)
		try {
			const jwks = getJwks(supabaseUrl);
			const result = await jwtVerify(token, jwks, {
				issuer: `${supabaseUrl}/auth/v1`,
				audience: "authenticated",
			});
			payload = result.payload as Record<string, unknown>;
		} catch {
			// Not a Supabase token. Is it a token of an app?
			const claims = await verifyAccessToken(token, tokenEnv(c));
			payload = { ...claims };
			fromApp = true;
			tokenAppId = claims.app_id;
		}

		// A token of an app reaches only what its scopes allow. This runs before any database work.
		if (fromApp) {
			const scopes = Array.isArray(payload.scopes)
				? payload.scopes.filter((s) => typeof s === "string")
				: [];
			// A token of an app is a sign-in on the routes that need one, and nowhere else.
			// The admin routes know an admin by the user id, so an app must never carry that id there.
			if (!requiresAuth) return next();
			const problem = appTokenProblem(path, scopes, c.req.method);
			if (problem) return problemJson(c, 403, problem);
			tokenScopes = scopes;
		}

		const userId = payload.sub as string;
		if (!userId) {
			return problemJson(c, 401, "Invalid token: missing subject.");
		}

		// Extract user info from JWT claims
		const email = (payload.email as string) ?? null;
		const userMetadata = (payload.user_metadata as Record<string, unknown>) ?? {};
		const name = (userMetadata.full_name as string) ?? (userMetadata.name as string) ?? null;
		const avatarUrl =
			(userMetadata.avatar_url as string) ?? (userMetadata.picture as string) ?? null;

		reader = { id: userId, email, name, avatarUrl };
	} catch (err) {
		const logger = c.get("logger");
		if (err instanceof Error) {
			if (err.message.includes("expired")) {
				return problemJson(c, 401, "Token has expired.");
			}
			logger?.warn("JWT verification failed", { error: err.message });
		}
		return problemJson(c, 401, "Invalid or expired token.");
	}

	// The token is good. A failure from here on is ours, not the reader's, so it must not answer 401:
	// a client signs the reader out on 401.
	try {
		const { id: userId, email, name, avatarUrl } = reader;

		// An access token lives for a time after it is made. A suspended app must stop at once, and an app
		// that went back to review must stop for other readers, so each request of an app checks the app.
		if (tokenAppId) {
			const { db: appDb } = getDb(c.env?.HYPERDRIVE);
			const [app] = await appDb
				.select({ status: apps.status, ownerId: apps.ownerId })
				.from(apps)
				.where(eq(apps.id, tokenAppId))
				.limit(1);
			// The reader can take the access back on the accounts site. That must hold from that moment.
			const problem = liveTokenProblem({
				app: app && isAppStatus(app.status) ? { status: app.status, ownerId: app.ownerId } : null,
				consented: await consentNow(appDb, userId, tokenAppId),
				userId,
				scopes: tokenScopes,
			});
			if (problem) return problemJson(c, problem.status, problem.detail);
			const env = (name: "FIRST_PARTY_APP_IDS" | "ADMIN_USER_IDS") =>
				(c.env?.[name] as string | undefined) ?? process.env[name];
			if (
				firstPartyOnly(path) &&
				!isFirstPartyApp(
					{ id: tokenAppId, ownerId: app?.ownerId ?? null },
					env("FIRST_PARTY_APP_IDS"),
					env("ADMIN_USER_IDS"),
				)
			)
				return problemJson(c, 403, "This app cannot use this route.");
		}
		// Lazy user creation: ensure user exists in our DB
		const { db } = getDb(c.env?.HYPERDRIVE);
		const [existing, deleted] = await Promise.all([
			db.select().from(users).where(eq(users.id, userId)).limit(1),
			isDeleted(db, userId),
		]);

		// A token stays good for a time after its reader deleted the account. From the moment of the mark
		// it is no sign-in, also while the delete is not finished: so no request adds a row behind it, and
		// none brings the reader's row back. The reader can still finish a delete that failed halfway.
		if (deleted) {
			if (!deletedAccountAllows({ method: c.req.method, path, fromApp: tokenAppId !== null })) {
				return problemJson(c, 401, "This account is deleted.");
			}
		} else if (existing.length === 0) {
			await createUserRow(db, { id: userId, email, name, avatarUrl });
		} else {
			// Sync profile fields from JWT if the DB record is missing them
			const row = existing[0];
			const updates: Record<string, unknown> = {};
			if (!row.name && name) updates.name = name;
			if (!row.avatarUrl && avatarUrl) updates.avatarUrl = avatarUrl;
			if (!row.email && email) updates.email = email;
			if (Object.keys(updates).length > 0) {
				await db.update(users).set(updates).where(eq(users.id, userId));
			}
		}

		c.set("user", reader);
	} catch (err) {
		// The kind of error only. The message of a database error can hold the reader's email or a host name.
		c.get("logger")?.error("auth: the lookup of the reader failed", {
			kind: err instanceof Error ? err.name : "unknown",
			code:
				typeof (err as { code?: unknown })?.code === "string"
					? (err as { code: string }).code
					: undefined,
		});
		c.header("Retry-After", "5");
		return problemJson(c, 503, "The service cannot check your sign-in at the moment. Try again.");
	}

	return next();
};
