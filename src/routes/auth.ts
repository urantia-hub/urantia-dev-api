import { createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { apps, authCodes } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import type { AuthUser } from "../middleware/auth.ts";
import { ErrorResponse } from "../validators/schemas.ts";

export const authRoute = createApp();

// ============================================================
// Helpers
// ============================================================

function getUser(c: { get: (key: "user") => AuthUser | null }): AuthUser {
	const user = c.get("user");
	if (!user) throw new Error("User not authenticated");
	return user;
}

async function sha256(input: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function verifyPkce(codeVerifier: string, codeChallenge: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const data = encoder.encode(codeVerifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return base64 === codeChallenge;
}

function isAdmin(c: { env?: Record<string, unknown> }, userId: string): boolean {
	const adminIds = ((c.env?.ADMIN_USER_IDS as string) ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	return adminIds.includes(userId);
}

// ============================================================
// Schemas
// ============================================================

const AppPublicSchema = z.object({
	id: z.string(),
	name: z.string(),
	scopes: z.array(z.string()),
});

const AppCreateBody = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	redirectUris: z.array(z.string().url()).min(1),
	scopes: z.array(z.string()).min(1),
});

const AppCreateResponse = z.object({
	id: z.string(),
	name: z.string(),
	redirectUris: z.array(z.string()),
	scopes: z.array(z.string()),
	secret: z.string(),
});

const AuthorizeBody = z.object({
	appId: z.string().min(1),
	redirectUri: z.string().url(),
	scopes: z.array(z.string()).min(1),
	codeChallenge: z.string().optional(),
	state: z.string().optional(),
});

const AuthorizeResponse = z.object({
	code: z.string(),
	state: z.string().optional(),
});

const TokenBody = z.object({
	code: z.string().min(1),
	appId: z.string().min(1),
	appSecret: z.string().min(1),
	codeVerifier: z.string().optional(),
});

const TokenResponse = z.object({
	userId: z.string(),
	email: z.string().nullable(),
	scopes: z.array(z.string()),
	expiresAt: z.string(),
});

// ============================================================
// 1. GET /apps/:id — Public app info
// ============================================================

const getAppRoute = createRoute({
	operationId: "getApp",
	method: "get",
	path: "/apps/{id}",
	tags: ["Auth"],
	summary: "Get public app info",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			description: "App public info",
			content: { "application/json": { schema: z.object({ data: AppPublicSchema }) } },
		},
		404: {
			description: "App not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(getAppRoute, async (c) => {
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);

	return c.json({ data: { id: app.id, name: app.name, scopes: app.scopes } }, 200);
});

// ============================================================
// 2. POST /apps — Register a new app (admin-only)
// ============================================================

const createAppRoute = createRoute({
	operationId: "createApp",
	method: "post",
	path: "/apps",
	tags: ["Auth"],
	summary: "Register a new OAuth app (admin-only)",
	request: { body: { content: { "application/json": { schema: AppCreateBody } } } },
	responses: {
		201: {
			description: "App created (secret shown once)",
			content: { "application/json": { schema: z.object({ data: AppCreateResponse }) } },
		},
		400: {
			description: "Validation error or duplicate ID",
			content: { "application/json": { schema: ErrorResponse } },
		},
		403: {
			description: "Admin access required",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(createAppRoute, async (c) => {
	const user = getUser(c);
	if (!isAdmin(c, user.id)) {
		return problemJson(c, 403, "Only admins can register apps.");
	}

	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	// Check for duplicate
	const [existing] = await db.select().from(apps).where(eq(apps.id, body.id)).limit(1);
	if (existing) {
		return problemJson(c, 400, `App with id "${body.id}" already exists.`);
	}

	// Generate secret and hash it
	const secret = crypto.randomUUID();
	const secretHash = await sha256(secret);

	await db.insert(apps).values({
		id: body.id,
		name: body.name,
		secretHash,
		redirectUris: body.redirectUris,
		scopes: body.scopes,
	});

	return c.json(
		{
			data: {
				id: body.id,
				name: body.name,
				redirectUris: body.redirectUris,
				scopes: body.scopes,
				secret,
			},
		},
		201,
	);
});

// ============================================================
// 3. POST /authorize — Create authorization code
// ============================================================

const authorizeRoute = createRoute({
	operationId: "authorize",
	method: "post",
	path: "/authorize",
	tags: ["Auth"],
	summary: "Create an authorization code (authenticated user)",
	request: { body: { content: { "application/json": { schema: AuthorizeBody } } } },
	responses: {
		200: {
			description: "Authorization code created",
			content: { "application/json": { schema: z.object({ data: AuthorizeResponse }) } },
		},
		400: {
			description: "Invalid redirect URI or scopes",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "App not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(authorizeRoute, async (c) => {
	const user = getUser(c);
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	// Look up app
	const [app] = await db.select().from(apps).where(eq(apps.id, body.appId)).limit(1);
	if (!app) return problemJson(c, 404, `App "${body.appId}" not found.`);

	// Validate redirect URI
	if (!app.redirectUris.includes(body.redirectUri)) {
		return problemJson(
			c,
			400,
			`Redirect URI "${body.redirectUri}" is not registered for this app.`,
		);
	}

	// Validate scopes are a subset of app's allowed scopes
	const invalidScopes = body.scopes.filter((s) => !app.scopes.includes(s));
	if (invalidScopes.length > 0) {
		return problemJson(
			c,
			400,
			`Invalid scopes: ${invalidScopes.join(", ")}. Allowed: ${app.scopes.join(", ")}.`,
		);
	}

	// Generate auth code with 5-minute expiry
	const code = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

	await db.insert(authCodes).values({
		code,
		appId: body.appId,
		userId: user.id,
		scopes: body.scopes,
		codeChallenge: body.codeChallenge ?? null,
		redirectUri: body.redirectUri,
		expiresAt,
	});

	return c.json({ data: { code, state: body.state } }, 200);
});

// ============================================================
// 4. POST /token — Exchange code for tokens
// ============================================================

const tokenRoute = createRoute({
	operationId: "exchangeToken",
	method: "post",
	path: "/token",
	tags: ["Auth"],
	summary: "Exchange authorization code for tokens",
	request: { body: { content: { "application/json": { schema: TokenBody } } } },
	responses: {
		200: {
			description: "Token response",
			content: { "application/json": { schema: z.object({ data: TokenResponse }) } },
		},
		400: {
			description: "Invalid, expired, or already-used code",
			content: { "application/json": { schema: ErrorResponse } },
		},
		401: {
			description: "Invalid app secret",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(tokenRoute, async (c) => {
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	// Look up the auth code
	const [authCode] = await db
		.select()
		.from(authCodes)
		.where(eq(authCodes.code, body.code))
		.limit(1);
	if (!authCode) {
		return problemJson(c, 400, "Invalid or already-used authorization code.");
	}

	// Check expiry
	if (authCode.expiresAt < new Date()) {
		// Clean up expired code
		await db.delete(authCodes).where(eq(authCodes.code, body.code));
		return problemJson(c, 400, "Authorization code has expired.");
	}

	// Verify appId matches
	if (authCode.appId !== body.appId) {
		return problemJson(c, 400, "App ID does not match the authorization code.");
	}

	// Look up the app and verify secret
	const [app] = await db.select().from(apps).where(eq(apps.id, body.appId)).limit(1);
	if (!app) {
		return problemJson(c, 400, "App not found.");
	}

	const secretHash = await sha256(body.appSecret);
	if (secretHash !== app.secretHash) {
		return problemJson(c, 401, "Invalid app secret.");
	}

	// PKCE verification
	if (authCode.codeChallenge) {
		if (!body.codeVerifier) {
			return problemJson(c, 400, "Code verifier is required for PKCE.");
		}
		const valid = await verifyPkce(body.codeVerifier, authCode.codeChallenge);
		if (!valid) {
			return problemJson(c, 400, "PKCE verification failed.");
		}
	}

	// Delete the code (one-time use)
	await db.delete(authCodes).where(eq(authCodes.code, body.code));

	// Return user info + scopes
	// Note: In a full implementation this would return a scoped JWT.
	// For now, return user info directly. This is a known limitation.
	const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

	return c.json(
		{
			data: {
				userId: authCode.userId,
				email: null as string | null, // email not stored on auth_codes; consumer uses Supabase token
				scopes: authCode.scopes,
				expiresAt: expiresAt.toISOString(),
			},
		},
		200,
	);
});
