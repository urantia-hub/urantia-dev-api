import { createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { apps, authCodes, users } from "../db/schema.ts";
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
	id: z.string().min(3).max(40).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Must be lowercase alphanumeric with hyphens, 3-40 chars"),
	name: z.string().min(1),
	redirectUris: z.array(z.string().url()).min(1),
	scopes: z.array(z.string()).min(1),
});

const AppListItem = z.object({
	id: z.string(),
	name: z.string(),
	redirectUris: z.array(z.string()),
	scopes: z.array(z.string()),
	createdAt: z.string(),
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
	appSecret: z.string().min(1).optional(),
	codeVerifier: z.string().optional(),
});

const TokenResponse = z.object({
	accessToken: z.string(),
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

	return c.json({ data: { id: app.id, name: app.name, scopes: app.scopes, redirectUris: app.redirectUris, createdAt: app.createdAt.toISOString() } }, 200);
});

// ============================================================
// 2. POST /apps — Register a new app (admin-only)
// ============================================================

const createAppRoute = createRoute({
	operationId: "createApp",
	method: "post",
	path: "/apps",
	tags: ["Auth"],
	summary: "Register a new OAuth app",
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
	},
});

authRoute.openapi(createAppRoute, async (c) => {
	const user = getUser(c);
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
		ownerId: user.id,
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

	// Verify app secret if provided
	if (body.appSecret) {
		const secretHash = await sha256(body.appSecret);
		if (secretHash !== app.secretHash) {
			return problemJson(c, 401, "Invalid app secret.");
		}
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

	// Require at least one auth method
	if (!body.appSecret && !authCode.codeChallenge) {
		return problemJson(c, 400, "Either appSecret or PKCE code_challenge is required.");
	}

	// Delete the code (one-time use)
	await db.delete(authCodes).where(eq(authCodes.code, body.code));

	// Look up user email from users table
	const [user] = await db
		.select({ email: users.email })
		.from(users)
		.where(eq(users.id, authCode.userId))
		.limit(1);

	// Generate a scoped JWT access token (1 hour expiry)
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

	const jwtSecret = c.env?.APP_JWT_SECRET as string;
	if (!jwtSecret) {
		return problemJson(c, 500, "JWT signing key not configured.");
	}

	const secret = new TextEncoder().encode(jwtSecret);
	const accessToken = await new SignJWT({
		sub: authCode.userId,
		email: user?.email ?? null,
		scopes: authCode.scopes,
		app_id: authCode.appId,
		iss: "https://accounts.urantiahub.com",
		aud: "authenticated",
	})
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(expiresAt)
		.sign(secret);

	return c.json(
		{
			data: {
				accessToken,
				userId: authCode.userId,
				email: user?.email ?? null,
				scopes: authCode.scopes,
				expiresAt: expiresAt.toISOString(),
			},
		},
		200,
	);
});

// ============================================================
// 5. GET /apps — List my apps
// ============================================================

const listAppsRoute = createRoute({
	operationId: "listMyApps",
	method: "get",
	path: "/apps",
	tags: ["Auth"],
	summary: "List OAuth apps owned by the authenticated user",
	responses: {
		200: {
			description: "List of apps",
			content: { "application/json": { schema: z.object({ data: z.array(AppListItem) }) } },
		},
	},
});

authRoute.openapi(listAppsRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);

	const results = await db
		.select({
			id: apps.id,
			name: apps.name,
			redirectUris: apps.redirectUris,
			scopes: apps.scopes,
			createdAt: apps.createdAt,
		})
		.from(apps)
		.where(eq(apps.ownerId, user.id));

	return c.json({
		data: results.map((app) => ({
			...app,
			createdAt: app.createdAt.toISOString(),
		})),
	}, 200);
});

// ============================================================
// 6. DELETE /apps/:id — Delete my app
// ============================================================

const deleteAppRoute = createRoute({
	operationId: "deleteApp",
	method: "delete",
	path: "/apps/{id}",
	tags: ["Auth"],
	summary: "Delete an OAuth app (owner-only)",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		204: { description: "App deleted" },
		403: {
			description: "Not the app owner",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "App not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(deleteAppRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);

	if (app.ownerId !== user.id && !isAdmin(c, user.id)) {
		return problemJson(c, 403, "You do not own this app.");
	}

	await db.delete(apps).where(eq(apps.id, id));
	return c.body(null, 204);
});

// ============================================================
// 7. POST /apps/:id/rotate-secret — Rotate app secret
// ============================================================

const rotateSecretRoute = createRoute({
	operationId: "rotateAppSecret",
	method: "post",
	path: "/apps/{id}/rotate-secret",
	tags: ["Auth"],
	summary: "Rotate the app secret (owner-only)",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			description: "New secret (shown once)",
			content: { "application/json": { schema: z.object({ data: z.object({ secret: z.string() }) }) } },
		},
		403: {
			description: "Not the app owner",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "App not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(rotateSecretRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);

	if (app.ownerId !== user.id && !isAdmin(c, user.id)) {
		return problemJson(c, 403, "You do not own this app.");
	}

	const secret = crypto.randomUUID();
	const secretHash = await sha256(secret);

	await db.update(apps).set({ secretHash }).where(eq(apps.id, id));

	return c.json({ data: { secret } }, 200);
});
