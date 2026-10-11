import { createRoute } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { apps, authCodes, refreshTokens, userConsents, users } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import {
	changeMail,
	decisionMail,
	requestMail,
	reviewSender,
	sendMail,
} from "../lib/app-review-mail.ts";
import {
	type AppStatus,
	canRegisterAnother,
	canUseApp,
	isAppStatus,
	isWebLink,
	MAX_PENDING_APPS,
} from "../lib/app-status.ts";
import { tokenEnv } from "../lib/app-tokens.ts";
import { createAuthStore } from "../lib/auth-store.ts";
import { problemJson } from "../lib/errors.ts";
import {
	AccessRemoved,
	issueSession,
	type RefreshResult,
	refreshSession,
	revokeSession,
	type Tokens,
} from "../lib/sessions.ts";
import { canIssueCode, firstPartyIds, isFirstPartyApp } from "../lib/token-access.ts";
import { ALLOWED_SCOPES, AppCreateBody, HexColor } from "../validators/app-schemas.ts";
import { createAccountStore } from "../lib/account-store.ts";
import { accountsMailKey } from "../lib/mail/hook.ts";
import {
	applyRequest,
	canLoadLogo,
	isLogoFile,
	logoKeys,
	newLogo,
	noteProblem,
	parseRequest,
	requestFor,
	sameAsSeen,
} from "../lib/change-request.ts";
import {
	decideChange,
	setReviewStatus,
	withdrawChange,
	writeEdit,
} from "../lib/change-store.ts";
import { deleteAccount, listAccess, refusalText, removeAccess } from "../lib/consents.ts";
import { adminSettings, removeSignIn } from "../lib/supabase-admin.ts";
import type { AuthUser } from "../middleware/auth.ts";
import { rateLimiter } from "../middleware/rate-limit.ts";
import { ErrorResponse } from "../validators/schemas.ts";

export const authRoute = createApp();

// ============================================================
// Helpers
// ============================================================

// The /auth/apps/ prefix is public (the consent screen reads app metadata), so
// the write routes under it reach the handler unauthenticated. Answer 401 with
// the same problem+json shape the auth middleware uses, never a 500.
function getUser(c: { get: (key: "user") => AuthUser | null }): AuthUser {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			res: Response.json(
				{
					type: "https://urantia.dev/errors/unauthorized",
					title: "Unauthorized",
					status: 401,
					detail: "Authentication required. Provide a valid Bearer token.",
				},
				{ status: 401, headers: { "Content-Type": "application/problem+json" } },
			),
		});
	}
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

const firstPartySetting = (c: { env?: Record<string, unknown> }) =>
	(c.env?.FIRST_PARTY_APP_IDS as string | undefined) ?? process.env.FIRST_PARTY_APP_IDS;

function isFirstParty(
	c: { env?: Record<string, unknown> },
	app: { id: string; ownerId: string | null },
): boolean {
	const admins = (c.env?.ADMIN_USER_IDS as string | undefined) ?? process.env.ADMIN_USER_IDS;
	return isFirstPartyApp(app, firstPartySetting(c), admins);
}

// The files of an app's logo. Used when the app, or its owner's account, is deleted.
async function removeLogos(bucket: R2Bucket | undefined, appId: string): Promise<void> {
	if (!bucket) return;
	const listed = await bucket.list({ prefix: `${appId}/` });
	await Promise.all(listed.objects.map((object) => bucket.delete(object.key)));
}

// The file behind one stored logo address. A file that stays is not a reason to fail a request.
async function removeLogoFile(
	bucket: R2Bucket | undefined,
	appId: string,
	url: string | null | undefined,
): Promise<void> {
	if (!bucket) return;
	await Promise.all(logoKeys(appId, url).map((key) => bucket.delete(key))).catch(() => {});
}

// The review status of an app row. A value that is not known counts as suspended: no one can use the app.
const statusOf = (app: { status: string }): AppStatus =>
	isAppStatus(app.status) ? app.status : "suspended";

const NOT_OPEN = "This app is not open yet. Its developer waits for a review.";

type MailEnv = { RESEND_API_KEY?: string; FEEDBACK_FROM?: string; FEEDBACK_TO?: string };
const mailEnv = (c: { env?: Record<string, unknown> }): MailEnv => ({
	// The review notices come from accounts.urantiahub.com, which has a Resend key of its own.
	RESEND_API_KEY: accountsMailKey({
		ACCOUNTS_RESEND_API_KEY:
			(c.env?.ACCOUNTS_RESEND_API_KEY as string | undefined) ?? process.env.ACCOUNTS_RESEND_API_KEY,
		RESEND_API_KEY: (c.env?.RESEND_API_KEY as string | undefined) ?? process.env.RESEND_API_KEY,
	}),
	// The review notices have their own sender, with a name. See reviewSender.
	FEEDBACK_FROM: reviewSender({
		APP_REVIEW_FROM: (c.env?.APP_REVIEW_FROM as string | undefined) ?? process.env.APP_REVIEW_FROM,
		FEEDBACK_FROM: (c.env?.FEEDBACK_FROM as string | undefined) ?? process.env.FEEDBACK_FROM,
	}),
	FEEDBACK_TO: (c.env?.FEEDBACK_TO as string | undefined) ?? process.env.FEEDBACK_TO,
});

// Tells each admin address that an app waits for a review. It never throws.
async function notifyAdmins(
	c: { env?: Record<string, unknown> },
	app: Parameters<typeof requestMail>[0],
	kind: "new" | "changed" | "request",
): Promise<void> {
	const env = mailEnv(c);
	const to = (env.FEEDBACK_TO ?? "").split(",").map((a) => a.trim()).filter(Boolean);
	await Promise.all(to.map((address) => sendMail(env, address, requestMail(app, kind))));
}

// Moves the app to pending if the edit needs a review. The database applies it to the row as it is now,
// so an edit cannot undo a suspension that an admin made a moment ago. True if the app moved.





/**
 * Dangerous schemes that must never be used as redirect URIs.
 */
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "ftp:", "blob:", "vbscript:"]);

/**
 * Validate a redirect URI.
 * - https:// allowed for any domain
 * - http://localhost:* and http://127.0.0.1:* allowed for development
 * - Custom schemes (e.g. urantiahub://) allowed for native apps
 * - Reject dangerous schemes: javascript:, data:, file:, ftp:, blob:, vbscript:
 */
function validateRedirectUri(uri: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(uri);
	} catch {
		return `Invalid URL: "${uri}"`;
	}
	const { protocol, hostname } = parsed;

	// Block dangerous schemes
	if (BLOCKED_SCHEMES.has(protocol)) {
		return `Blocked scheme "${protocol}" in "${uri}".`;
	}

	// http:// only allowed for localhost
	if (protocol === "http:" && hostname !== "localhost" && hostname !== "127.0.0.1") {
		return `http:// is only allowed for localhost and 127.0.0.1. Use https:// for "${hostname}".`;
	}

	return null;
}

/**
 * Validate an array of redirect URIs. Returns null if all valid, or the first error message.
 */
function validateRedirectUris(uris: string[]): string | null {
	for (const uri of uris) {
		const error = validateRedirectUri(uri);
		if (error) return error;
	}
	return null;
}

// ============================================================
// Schemas
// ============================================================



const AppPublicSchema = z.object({
	id: z.string(),
	name: z.string(),
	scopes: z.array(z.string()),
	logoUrl: z.string().nullable(),
	primaryColor: z.string().nullable(),
	accentColor: z.string().nullable(),
	// One of our own apps. A reader does not see the consent screen for it.
	firstParty: z.boolean(),
	// pending, approved, declined, or suspended. Only an approved app is open to each reader.
	status: z.string(),
});

// A change request, as the owner and the admins see it. Only the fields that are new.
const PendingChange = z
	.object({
		id: z.string(),
		requestedAt: z.string(),
		name: z.string().optional(),
		redirectUris: z.array(z.string()).optional(),
		scopes: z.array(z.string()).optional(),
		logoUrl: z.string().optional(),
	})
	.nullable();

const Conflict = {
	description: "The app changed since the reviewer looked",
	content: { "application/json": { schema: ErrorResponse } },
};
const BadRequest = {
	description: "A note is needed",
	content: { "application/json": { schema: ErrorResponse } },
};

const AppUpdateBody = z.object({
	name: z.string().min(1).max(100).optional(),
	redirectUris: z.array(z.string().min(1)).min(1).optional(),
	scopes: z.array(z.enum(ALLOWED_SCOPES as [string, ...string[]])).min(1).optional(),
	primaryColor: HexColor.nullable().optional(),
	accentColor: HexColor.nullable().optional(),
}).refine((data) => data.name !== undefined || data.redirectUris !== undefined || data.scopes !== undefined || data.primaryColor !== undefined || data.accentColor !== undefined, {
	message: "At least one field must be provided.",
});

const AppUpdateResponse = z.object({
	id: z.string(),
	name: z.string(),
	redirectUris: z.array(z.string()),
	scopes: z.array(z.string()),
	logoUrl: z.string().nullable(),
	primaryColor: z.string().nullable(),
	accentColor: z.string().nullable(),
	ownerId: z.string().nullable(),
	createdAt: z.string(),
});

const AppListItem = z.object({
	id: z.string(),
	name: z.string(),
	redirectUris: z.array(z.string()),
	scopes: z.array(z.string()),
	logoUrl: z.string().nullable(),
	primaryColor: z.string().nullable(),
	accentColor: z.string().nullable(),
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
	redirectUri: z.string().min(1),
	scopes: z.array(z.string()).min(1),
	codeChallenge: z.string().optional(),
	state: z.string().optional(),
	// True only when the reader pressed Allow on the consent screen.
	grant: z.boolean().optional(),
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
	redirectUri: z.string().optional(),
});

const TokenResponse = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
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

	// The review fields are for the owner and for an admin. The public record does not hold them.
	const viewer = c.get("user");
	const review =
		viewer && (viewer.id === app.ownerId || isAdmin(c, viewer.id))
			? {
					description: app.description ?? null,
					websiteUrl: app.websiteUrl ?? null,
					reviewNote: app.reviewNote ?? null,
					pendingChange: parseRequest(app.pendingChange),
				}
			: {};

	return c.json({ data: { id: app.id, name: app.name, scopes: app.scopes, logoUrl: app.logoUrl ?? null, primaryColor: app.primaryColor ?? null, accentColor: app.accentColor ?? null, firstParty: isFirstParty(c, app), status: statusOf(app), redirectUris: app.redirectUris, createdAt: app.createdAt.toISOString(), ...review } }, 200);
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
	request: { body: { required: true, content: { "application/json": { schema: AppCreateBody } } } },
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

// Each new app sends an email to each admin. This limit holds for one Worker instance, so it slows a
// flood down and does not stop it. The cap on apps in review is the hard limit.
const createAppLimit = rateLimiter({ windowMs: 60 * 60 * 1000, max: 5, scope: "app-create" });
authRoute.use("/apps", async (c, next) => (c.req.method === "POST" ? createAppLimit(c, next) : next()));

authRoute.openapi(createAppRoute, async (c) => {
	const user = getUser(c);
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	// An id of one of our own apps is not free for another reader, also when that app does not exist yet.
	if (firstPartyIds(firstPartySetting(c)).includes(body.id) && !isAdmin(c, user.id)) {
		return problemJson(c, 400, `The id "${body.id}" is reserved.`);
	}

	// Check for duplicate
	const [existing] = await db.select().from(apps).where(eq(apps.id, body.id)).limit(1);
	if (existing) {
		return problemJson(c, 400, `App with id "${body.id}" already exists.`);
	}

	// Validate redirect URIs
	const uriError = validateRedirectUris(body.redirectUris);
	if (uriError) {
		return problemJson(c, 400, uriError);
	}

	// Each new app sends an email to each admin. One reader cannot fill that inbox.
	if (!isAdmin(c, user.id)) {
		const waiting = await db
			.select({ id: apps.id })
			.from(apps)
			.where(and(eq(apps.ownerId, user.id), eq(apps.status, "pending")));
		if (!canRegisterAnother(waiting.length)) {
			return problemJson(
				c,
				400,
				`You have ${MAX_PENDING_APPS} apps in review. Wait for a decision before you register another.`,
			);
		}
	}

	// Generate secret and hash it
	const secret = crypto.randomUUID();
	const secretHash = await sha256(secret);
	const status: AppStatus = isAdmin(c, user.id) ? "approved" : "pending";

	await db.insert(apps).values({
		id: body.id,
		name: body.name,
		secretHash,
		redirectUris: body.redirectUris,
		scopes: body.scopes,
		ownerId: user.id,
		primaryColor: body.primaryColor ?? null,
		accentColor: body.accentColor ?? null,
		// An app of an admin needs no review. Each other app waits for one.
		status,
		reviewedAt: status === "approved" ? new Date() : null,
		description: body.description || null,
		websiteUrl: body.websiteUrl || null,
	});

	if (status === "pending") {
		await notifyAdmins(
			c,
			{
				id: body.id,
				name: body.name,
				description: body.description ?? null,
				websiteUrl: body.websiteUrl ?? null,
				redirectUris: body.redirectUris,
				scopes: body.scopes,
				ownerEmail: user.email,
			},
			"new",
		);
	}

	return c.json(
		{
			data: {
				id: body.id,
				name: body.name,
				redirectUris: body.redirectUris,
				scopes: body.scopes,
				secret,
				status,
			},
		},
		201,
	);
});

// ============================================================
// 2B. GET /consent — Check if user has already consented
// ============================================================

const consentCheckRoute = createRoute({
	operationId: "checkConsent",
	method: "get",
	path: "/consent",
	tags: ["Auth"],
	summary: "Check if the user has already consented to an app's scopes",
	request: {
		query: z.object({
			appId: z.string().min(1),
			scopes: z.string().min(1), // comma-separated
		}),
	},
	responses: {
		200: {
			description: "Consent status",
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							consented: z.boolean(),
							grantedScopes: z.array(z.string()),
						}),
					}),
				},
			},
		},
	},
});

authRoute.openapi(consentCheckRoute, async (c) => {
	const user = getUser(c);
	const { appId, scopes: scopeStr } = c.req.valid("query");
	const requestedScopes = scopeStr.split(",").map((s) => s.trim()).filter(Boolean);
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [grant] = await db
		.select({ scopes: userConsents.scopes })
		.from(userConsents)
		.where(and(eq(userConsents.userId, user.id), eq(userConsents.appId, appId)))
		.limit(1);

	const grantedScopes = grant?.scopes ?? [];
	const consented = requestedScopes.every((s) => grantedScopes.includes(s));

	return c.json({ data: { consented, grantedScopes } }, 200);
});

// ============================================================
// 2c. The reader's account: the apps with access, remove one, delete the account
// ============================================================

const accessListRoute = createRoute({
	operationId: "listAppAccess",
	method: "get",
	path: "/consents",
	tags: ["Auth"],
	summary: "The other apps that the reader allowed",
	responses: {
		200: {
			description: "Apps with access",
			content: {
				"application/json": {
					schema: z.object({
						data: z.array(
							z.object({
								appId: z.string(),
								name: z.string(),
								logoUrl: z.string().nullable(),
								primaryColor: z.string().nullable(),
								scopes: z.array(z.string()),
								grantedAt: z.string(),
							}),
						),
					}),
				},
			},
		},
	},
});

authRoute.openapi(accessListRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);
	const data = await listAccess(createAccountStore(db), user.id, (app) => isFirstParty(c, app));
	return c.json({ data }, 200);
});

const accessRemoveRoute = createRoute({
	operationId: "removeAppAccess",
	method: "delete",
	path: "/consents/{appId}",
	tags: ["Auth"],
	summary: "Remove the access of one app",
	request: { params: z.object({ appId: z.string().min(1).max(60) }) },
	responses: { 204: { description: "Removed" } },
});

authRoute.openapi(accessRemoveRoute, async (c) => {
	const user = getUser(c);
	const { appId } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);
	await removeAccess(createAccountStore(db), user.id, appId);
	return c.body(null, 204);
});

const accountDeleteRoute = createRoute({
	operationId: "deleteAccount",
	method: "delete",
	path: "/account",
	tags: ["Auth"],
	summary: "Delete the reader's account and data",
	request: {
		body: {
			required: true,
			content: { "application/json": { schema: z.object({ email: z.string().max(320) }) } },
		},
	},
	responses: {
		204: { description: "Deleted" },
		400: { description: "The email does not match", content: { "application/json": { schema: ErrorResponse } } },
		409: { description: "The reader owns an app that other people use", content: { "application/json": { schema: ErrorResponse } } },
		503: { description: "Not ready", content: { "application/json": { schema: ErrorResponse } } },
	},
});

authRoute.openapi(accountDeleteRoute, async (c) => {
	const user = getUser(c);
	const body = c.req.valid("json");
	// Without the key the sign-in itself cannot be removed. Stop before anything is deleted.
	const admin = adminSettings(c.env ?? process.env);
	if (!admin) return problemJson(c, 503, "Account deletion is not ready. Write to hi@urantiahub.com.");

	const { db } = getDb(c.env?.HYPERDRIVE);
	const store = createAccountStore(db);
	const owned = await store.ownedApps(user.id);
	const result = await deleteAccount(store, {
		userId: user.id,
		email: user.email,
		typedEmail: body.email,
		isAdmin: isAdmin(c, user.id),
		removeSignIn: (id) => removeSignIn(admin, id),
	});
	if (!result.ok) {
		return problemJson(c, result.reason === "email" ? 400 : 409, refusalText(result));
	}
	// The logos of the reader's own apps. A file that stays is not a reason to fail the delete.
	await Promise.all(owned.map((app) => removeLogos(c.env?.APP_LOGOS, app.id))).catch(() => {});
	c.get("logger")?.info("account deleted");
	return c.body(null, 204);
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
	request: { body: { required: true, content: { "application/json": { schema: AuthorizeBody } } } },
	responses: {
		200: {
			description: "Authorization code created",
			content: { "application/json": { schema: z.object({ data: AuthorizeResponse }) } },
		},
		400: {
			description: "Invalid redirect URI or scopes",
			content: { "application/json": { schema: ErrorResponse } },
		},
		403: {
			description: "The reader did not allow these permissions",
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

	// Sync profile from Supabase JWT (may have fresh Google OAuth data)
	if (user.name || user.avatarUrl) {
		const updates: Record<string, unknown> = {};
		if (user.name) updates.name = user.name;
		if (user.avatarUrl) updates.avatarUrl = user.avatarUrl;
		if (user.email) updates.email = user.email;
		await db.update(users).set(updates).where(eq(users.id, user.id));
	}

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

	// Only an approved app is open to each reader. Its owner can use it before that, to build and test.
	if (!canUseApp({ status: statusOf(app), ownerId: app.ownerId }, user.id)) {
		return problemJson(c, 403, NOT_OPEN);
	}

	// A code for a new permission needs a press on Allow, unless the app is ours.
	const [existing] = await db
		.select({ scopes: userConsents.scopes })
		.from(userConsents)
		.where(and(eq(userConsents.userId, user.id), eq(userConsents.appId, body.appId)))
		.limit(1);

	if (
		!canIssueCode({
			requested: body.scopes,
			consented: existing?.scopes ?? [],
			firstParty: isFirstParty(c, app),
			grant: body.grant === true,
		})
	) {
		return problemJson(c, 403, "The reader did not allow these permissions.");
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

	// Record/update consent grant (merge scopes)
	const mergedScopes = existing
		? [...new Set([...existing.scopes, ...body.scopes])]
		: body.scopes;

	if (existing) {
		await db
			.update(userConsents)
			.set({ scopes: mergedScopes, grantedAt: new Date() })
			.where(and(eq(userConsents.userId, user.id), eq(userConsents.appId, body.appId)));
	} else {
		await db.insert(userConsents).values({
			userId: user.id,
			appId: body.appId,
			scopes: body.scopes,
		});
	}

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
	request: { body: { required: true, content: { "application/json": { schema: TokenBody } } } },
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
		500: {
			description: "Internal server error",
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

	// RFC 6749: re-validate redirect_uri on token exchange
	if (body.redirectUri) {
		if (body.redirectUri !== authCode.redirectUri) {
			await db.delete(authCodes).where(eq(authCodes.code, body.code));
			return problemJson(c, 400, "Redirect URI does not match the one used during authorization.");
		}
	}

	// Look up the app and verify secret
	const [app] = await db.select().from(apps).where(eq(apps.id, body.appId)).limit(1);
	if (!app) {
		return problemJson(c, 400, "App not found.");
	}
	// The status can change between the code and its exchange.
	if (!canUseApp({ status: statusOf(app), ownerId: app.ownerId }, authCode.userId)) {
		await db.delete(authCodes).where(eq(authCodes.code, body.code));
		return problemJson(c, 400, NOT_OPEN);
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

	// Delete the code (one-time use). Two requests with one code can arrive together: only the one
	// that deletes the row goes on.
	const used = await db
		.delete(authCodes)
		.where(eq(authCodes.code, body.code))
		.returning({ code: authCodes.code });
	if (used.length === 0) {
		return problemJson(c, 400, "Invalid or already-used authorization code.");
	}

	// Look up user email from users table
	const [user] = await db
		.select({ email: users.email })
		.from(users)
		.where(eq(users.id, authCode.userId))
		.limit(1);

	// A new sign-in: an access token and the first refresh token of a new family.
	let tokens: Tokens;
	try {
		tokens = await issueSession(createAuthStore(db), tokenEnv(c), {
			userId: authCode.userId,
			appId: authCode.appId,
			scopes: authCode.scopes,
			email: user?.email ?? null,
		});
	} catch (error) {
		if (error instanceof AccessRemoved) {
			return problemJson(c, 400, "The reader removed the access of this app.");
		}
		return problemJson(c, 500, "JWT signing key not configured.");
	}

	return c.json({ data: tokens }, 200);
});

// ============================================================
// 4B. POST /refresh — Refresh access token
// ============================================================

const RefreshBody = z.object({
	refreshToken: z.string().min(1),
	appId: z.string().min(1),
});

const refreshRoute = createRoute({
	operationId: "refreshToken",
	method: "post",
	path: "/refresh",
	tags: ["Auth"],
	summary: "Exchange a refresh token for a new access token + refresh token",
	request: { body: { required: true, content: { "application/json": { schema: RefreshBody } } } },
	responses: {
		200: {
			description: "New token pair",
			content: { "application/json": { schema: z.object({ data: TokenResponse }) } },
		},
		400: {
			description: "Invalid or expired refresh token",
			content: { "application/json": { schema: ErrorResponse } },
		},
		401: {
			description: "Refresh token reused (theft detected) — all tokens revoked",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(refreshRoute, async (c) => {
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	let result: RefreshResult;
	try {
		result = await refreshSession(createAuthStore(db), tokenEnv(c), body);
	} catch {
		return problemJson(c, 500, "JWT signing key not configured.");
	}
	if (!result.ok) return problemJson(c, result.status, result.detail);
	return c.json({ data: result.tokens }, 200);
});

// ============================================================
// 4C. POST /revoke — End one sign-in
// ============================================================

const revokeRoute = createRoute({
	operationId: "revokeToken",
	method: "post",
	path: "/revoke",
	tags: ["Auth"],
	summary: "End the sign-in that a refresh token belongs to",
	request: {
		body: { content: { "application/json": { schema: RefreshBody } }, required: true },
	},
	responses: {
		200: {
			description:
				"Done. signOutToken lets the accounts site end its own session. It is null for a token that is not known.",
			content: {
				"application/json": {
					schema: z.object({ data: z.object({ signOutToken: z.string().nullable() }) }),
				},
			},
		},
		400: {
			description: "The body is not valid",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(revokeRoute, async (c) => {
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);
	const data = await revokeSession(createAuthStore(db), tokenEnv(c), body);
	return c.json({ data }, 200);
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
			logoUrl: apps.logoUrl,
			primaryColor: apps.primaryColor,
			accentColor: apps.accentColor,
			status: apps.status,
			description: apps.description,
			websiteUrl: apps.websiteUrl,
			reviewNote: apps.reviewNote,
			pendingChange: apps.pendingChange,
			createdAt: apps.createdAt,
		})
		.from(apps)
		.where(eq(apps.ownerId, user.id));

	return c.json({
		data: results.map((app) => ({
			...app,
			logoUrl: app.logoUrl ?? null,
			primaryColor: app.primaryColor ?? null,
			accentColor: app.accentColor ?? null,
			pendingChange: parseRequest(app.pendingChange),
			firstParty: isFirstParty(c, { id: app.id, ownerId: user.id }),
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
	await removeLogos(c.env?.APP_LOGOS, id).catch(() => {});
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

// ============================================================
// 8. PATCH /apps/:id — Update my app
// ============================================================

const updateAppRoute = createRoute({
	operationId: "updateApp",
	method: "patch",
	path: "/apps/{id}",
	tags: ["Auth"],
	summary: "Update an OAuth app (owner-only)",
	request: {
		params: z.object({ id: z.string() }),
		body: { required: true, content: { "application/json": { schema: AppUpdateBody } } },
	},
	responses: {
		200: {
			description: "App updated",
			content: { "application/json": { schema: z.object({ data: AppUpdateResponse }) } },
		},
		400: {
			description: "Validation error",
			content: { "application/json": { schema: ErrorResponse } },
		},
		401: {
			description: "Not authenticated",
			content: { "application/json": { schema: ErrorResponse } },
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

authRoute.openapi(updateAppRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);
	const logger = c.get("logger");

	// Look up the app
	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);

	// Owner check
	if (app.ownerId !== user.id && !isAdmin(c, user.id)) {
		return problemJson(c, 403, "You do not own this app.");
	}

	// Validate redirect URIs if provided
	if (body.redirectUris) {
		const uriError = validateRedirectUris(body.redirectUris);
		if (uriError) {
			return problemJson(c, 400, uriError);
		}
	}

	logger?.info(`[auth] PATCH /apps/${id}`, { userId: user.id });

	const admin = isAdmin(c, user.id);
	const live = {
		name: app.name,
		redirectUris: app.redirectUris,
		scopes: app.scopes,
		logoUrl: app.logoUrl ?? null,
	};
	const existing = parseRequest(app.pendingChange);
	// What a reviewer must see: a new name, a new address, a new permission. An edit of the colors only
	// touches none of them, and leaves a request that waits alone.
	const touchesReviewed =
		body.name !== undefined || body.redirectUris !== undefined || body.scopes !== undefined;
	const request = touchesReviewed
		? requestFor(
				live,
				{ name: body.name, redirectUris: body.redirectUris, scopes: body.scopes },
				existing,
				{ id: crypto.randomUUID(), now: new Date() },
			)
		: undefined;

	// One statement, which decides from the row as it is now. An approved app keeps its reviewed values
	// and holds the request. Any other app takes the values at once. So an approved app never has a
	// name or an address that no reviewer saw, and an edit cannot undo a suspension.
	const written = await writeEdit(db, id, {
		wanted: {
			name: body.name?.trim(),
			redirectUris: body.redirectUris,
			scopes: body.scopes,
			primaryColor: body.primaryColor,
			accentColor: body.accentColor,
		},
		request,
		byAdmin: admin,
	});
	if (!written) return problemJson(c, 404, `App "${id}" not found.`);

	// A logo that waited, and that no request holds now.
	if (existing?.logoUrl && written.pendingChange?.logoUrl !== existing.logoUrl) {
		await removeLogoFile(c.env?.APP_LOGOS, id, existing.logoUrl);
	}

	const asked = written.pendingChange;
	const newRequest = written.status === "approved" && asked && asked.id !== existing?.id;
	const backInReview = statusOf(app) === "declined" && written.status === "pending";
	if (newRequest || backInReview) {
		const shown = asked ? applyRequest(live, asked) : null;
		await notifyAdmins(
			c,
			{
				id,
				name: shown?.name ?? body.name ?? app.name,
				description: app.description,
				websiteUrl: app.websiteUrl,
				redirectUris: shown?.redirectUris ?? body.redirectUris ?? app.redirectUris,
				scopes: shown?.scopes ?? body.scopes ?? app.scopes,
				ownerEmail: user.email,
			},
			newRequest ? "request" : "changed",
		);
	}

	// If scopes changed, invalidate all existing auth codes for this app
	if (body.scopes !== undefined) {
		const deleted = await db.delete(authCodes).where(eq(authCodes.appId, id));
		logger?.info(`[auth] Scopes changed for app "${id}", deleted auth codes`, {
			appId: id,
			deletedCount: deleted.length,
		});
	}

	// Fetch the updated app to return
	const [updated] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);

	return c.json(
		{
			data: {
				id: updated!.id,
				name: updated!.name,
				redirectUris: updated!.redirectUris,
				scopes: updated!.scopes,
				logoUrl: updated!.logoUrl ?? null,
				primaryColor: updated!.primaryColor ?? null,
				accentColor: updated!.accentColor ?? null,
				ownerId: updated!.ownerId,
				status: statusOf(updated!),
				pendingChange: parseRequest(updated!.pendingChange),
				createdAt: updated!.createdAt.toISOString(),
			},
		},
		200,
	);
});

// ============================================================
// 9. POST /apps/:id/logo — Upload app logo (owner-only)
// ============================================================

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB

const uploadLogoRoute = createRoute({
	operationId: "uploadAppLogo",
	method: "post",
	path: "/apps/{id}/logo",
	tags: ["Auth"],
	summary: "Upload an app logo (owner-only, max 2MB, PNG/JPEG/WebP)",
	request: {
		params: z.object({ id: z.string() }),
		body: { required: true, content: { "multipart/form-data": { schema: z.object({ logo: z.any() }) } } },
	},
	responses: {
		200: {
			description: "Logo uploaded",
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({ logoUrl: z.string().nullable(), pendingChange: PendingChange }),
					}),
				},
			},
		},
		400: {
			description: "Invalid file",
			content: { "application/json": { schema: ErrorResponse } },
		},
		403: {
			description: "Not the app owner",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "App not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(uploadLogoRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	// Look up app and verify ownership
	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);
	if (app.ownerId !== user.id && !isAdmin(c, user.id)) {
		return problemJson(c, 403, "You do not own this app.");
	}

	// Get R2 bucket
	const bucket = c.env?.APP_LOGOS;
	if (!bucket) return problemJson(c, 500, "Logo storage not configured.");

	// Parse multipart form
	const formData = await c.req.formData();
	const raw = formData.get("logo");
	if (!raw || typeof raw === "string") {
		return problemJson(c, 400, 'Missing "logo" file in form data.');
	}
	const file = raw as unknown as File;

	// Validate MIME type
	if (!ALLOWED_MIME_TYPES.includes(file.type)) {
		return problemJson(c, 400, `Invalid file type "${file.type}". Allowed: PNG, JPEG, WebP.`);
	}

	// Validate size
	if (file.size > MAX_LOGO_SIZE) {
		return problemJson(c, 400, `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 2MB.`);
	}

	// Each upload gets a key of its own. So a logo that waits for a review never replaces the live one.
	const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
	const logo = newLogo(id, ext, crypto.randomUUID());
	await bucket.put(logo.key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
	});

	// A new logo is a new face on the sign-in screen. On an approved app it waits for a reviewer;
	// on any other app it is live at once. The database decides, from the app as it is now.
	const live = {
		name: app.name,
		redirectUris: app.redirectUris,
		scopes: app.scopes,
		logoUrl: app.logoUrl ?? null,
	};
	const existing = parseRequest(app.pendingChange);
	const request = requestFor(live, { logoUrl: logo.url }, existing, {
		id: crypto.randomUUID(),
		now: new Date(),
	});
	const written = await writeEdit(db, id, {
		wanted: { logoUrl: logo.url },
		request,
		byAdmin: isAdmin(c, user.id),
	});
	const [after] = await db
		.select({ logoUrl: apps.logoUrl })
		.from(apps)
		.where(eq(apps.id, id))
		.limit(1);

	// The files that nothing points at now: the old live logo, and an older logo that waited.
	const kept = [after?.logoUrl ?? null, written?.pendingChange?.logoUrl ?? null];
	for (const old of [app.logoUrl, existing?.logoUrl]) {
		if (old && !kept.includes(old)) await removeLogoFile(bucket, id, old);
	}

	if (written?.status === "approved" && written.pendingChange?.id !== existing?.id) {
		await notifyAdmins(
			c,
			{
				id,
				name: app.name,
				description: app.description,
				websiteUrl: app.websiteUrl,
				redirectUris: app.redirectUris,
				scopes: app.scopes,
				ownerEmail: user.email,
			},
			"request",
		);
	}

	return c.json(
		{ data: { logoUrl: after?.logoUrl ?? null, pendingChange: written?.pendingChange ?? null } },
		200,
	);
});

// ============================================================
// 10. DELETE /apps/:id/logo — Remove app logo (owner-only)
// ============================================================

const deleteLogoRoute = createRoute({
	operationId: "deleteAppLogo",
	method: "delete",
	path: "/apps/{id}/logo",
	tags: ["Auth"],
	summary: "Remove an app logo (owner-only)",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		204: { description: "Logo removed" },
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

authRoute.openapi(deleteLogoRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);
	if (app.ownerId !== user.id && !isAdmin(c, user.id)) {
		return problemJson(c, 403, "You do not own this app.");
	}

	// Less is safe: an app with no logo shows a letter. So a removal needs no review.
	await db.update(apps).set({ logoUrl: null }).where(eq(apps.id, id));
	await removeLogoFile(c.env?.APP_LOGOS, id, app.logoUrl);

	return c.body(null, 204);
});

// ============================================================
// 11. GET /apps/:id/logo — Serve app logo from R2 (public)
// ============================================================

const getLogoRoute = createRoute({
	operationId: "getAppLogo",
	method: "get",
	path: "/apps/{id}/logo",
	tags: ["Auth"],
	summary: "Get app logo image (public)",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: { description: "Logo image" },
		404: {
			description: "No logo found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(getLogoRoute, async (c) => {
	const { id } = c.req.valid("param");
	const bucket = c.env?.APP_LOGOS;
	if (!bucket) return problemJson(c, 404, "No logo found.");

	// The same rule as for a logo file: public for an approved app only.
	const { db } = getDb(c.env?.HYPERDRIVE);
	const [app] = await db
		.select({ status: apps.status, ownerId: apps.ownerId })
		.from(apps)
		.where(eq(apps.id, id))
		.limit(1);
	const viewer = c.get("user");
	const ownerOrAdmin = !!viewer && !!app && (viewer.id === app.ownerId || isAdmin(c, viewer.id));
	if (!app || (statusOf(app) !== "approved" && !ownerOrAdmin)) {
		return problemJson(c, 404, "No logo found.");
	}

	// Try each extension
	for (const ext of ["png", "jpg", "webp"]) {
		const object = await bucket.get(`${id}/logo.${ext}`);
		if (object) {
			const headers = new Headers();
			headers.set("Content-Type", object.httpMetadata?.contentType ?? "image/png");
			headers.set(
				"Cache-Control",
				statusOf(app) === "approved" ? "public, max-age=86400" : "private, no-store",
			);
			headers.set("X-Content-Type-Options", "nosniff");
			headers.set("ETag", object.httpEtag);
			return new Response(object.body as ReadableStream, { status: 200, headers });
		}
	}

	return problemJson(c, 404, "No logo found.");
});

const getLogoFileRoute = createRoute({
	operationId: "getAppLogoFile",
	method: "get",
	path: "/apps/{id}/logo/{file}",
	tags: ["Auth"],
	summary: "Get one logo file of an app (public)",
	request: { params: z.object({ id: z.string(), file: z.string() }) },
	responses: {
		200: { description: "Logo image" },
		404: {
			description: "No logo found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

// Each person can load the live logo of an approved app. The logo of an app that is not approved, and
// a logo that waits for a review, are for the owner and for an admin only: the page of the accounts
// site loads them with the reader's sign-in.
authRoute.openapi(getLogoFileRoute, async (c) => {
	const { id, file } = c.req.valid("param");
	const bucket = c.env?.APP_LOGOS;
	if (!bucket || !isLogoFile(file)) return problemJson(c, 404, "No logo found.");

	const { db } = getDb(c.env?.HYPERDRIVE);
	const [app] = await db
		.select({
			status: apps.status,
			ownerId: apps.ownerId,
			logoUrl: apps.logoUrl,
			pendingChange: apps.pendingChange,
		})
		.from(apps)
		.where(eq(apps.id, id))
		.limit(1);
	const viewer = c.get("user");
	const ownerOrAdmin = !!viewer && !!app && (viewer.id === app.ownerId || isAdmin(c, viewer.id));
	const url = `https://api.urantia.dev/auth/apps/${id}/logo/${file}`;
	const open =
		!!app &&
		canLoadLogo(
			{
				status: statusOf(app),
				logoUrl: app.logoUrl ?? null,
				waitingLogoUrl: parseRequest(app.pendingChange)?.logoUrl ?? null,
			},
			url,
			ownerOrAdmin,
		);
	if (!open) return problemJson(c, 404, "No logo found.");

	const object = await bucket.get(`${id}/logo-${file}`);
	if (!object) return problemJson(c, 404, "No logo found.");
	const headers = new Headers();
	// The type comes from the name that we gave the file, never from what was uploaded with it.
	const ext = file.slice(file.lastIndexOf(".") + 1);
	headers.set("Content-Type", ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
	// Only the public case can be kept by a cache that other people share.
	const isPublic = statusOf(app) === "approved" && url === app.logoUrl;
	headers.set("Cache-Control", isPublic ? "public, max-age=31536000, immutable" : "private, no-store");
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("ETag", object.httpEtag);
	return new Response(object.body as ReadableStream, { status: 200, headers });
});

// ============================================================
// 12. GET /admin/check — Check if user is admin
// ============================================================

const adminCheckRoute = createRoute({
	operationId: "adminCheck",
	method: "get",
	path: "/admin/check",
	tags: ["Admin"],
	summary: "Check if the authenticated user is an admin",
	responses: {
		200: {
			description: "Admin status",
			content: { "application/json": { schema: z.object({ data: z.object({ isAdmin: z.boolean() }) }) } },
		},
	},
});

authRoute.openapi(adminCheckRoute, async (c) => {
	const user = getUser(c);
	return c.json({ data: { isAdmin: isAdmin(c, user.id) } }, 200);
});

// ============================================================
// 13. GET /admin/apps — List all apps (admin-only)
// ============================================================

const AdminAppListItem = z.object({
	id: z.string(),
	name: z.string(),
	redirectUris: z.array(z.string()),
	scopes: z.array(z.string()),
	logoUrl: z.string().nullable(),
	primaryColor: z.string().nullable(),
	accentColor: z.string().nullable(),
	ownerId: z.string().nullable(),
	ownerEmail: z.string().nullable(),
	createdAt: z.string(),
});

const adminListAppsRoute = createRoute({
	operationId: "adminListApps",
	method: "get",
	path: "/admin/apps",
	tags: ["Admin"],
	summary: "List all OAuth apps (admin-only)",
	responses: {
		200: {
			description: "All apps with owner info",
			content: { "application/json": { schema: z.object({ data: z.array(AdminAppListItem) }) } },
		},
		403: {
			description: "Not an admin",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(adminListAppsRoute, async (c) => {
	const user = getUser(c);
	if (!isAdmin(c, user.id)) {
		return problemJson(c, 403, "Admin access required.");
	}

	const { db } = getDb(c.env?.HYPERDRIVE);

	const results = await db
		.select({
			id: apps.id,
			name: apps.name,
			redirectUris: apps.redirectUris,
			scopes: apps.scopes,
			logoUrl: apps.logoUrl,
			primaryColor: apps.primaryColor,
			accentColor: apps.accentColor,
			ownerId: apps.ownerId,
			ownerEmail: users.email,
			status: apps.status,
			description: apps.description,
			websiteUrl: apps.websiteUrl,
			reviewNote: apps.reviewNote,
			reviewedAt: apps.reviewedAt,
			pendingChange: apps.pendingChange,
			createdAt: apps.createdAt,
		})
		.from(apps)
		.leftJoin(users, eq(apps.ownerId, users.id))
		.orderBy(apps.createdAt);

	return c.json({
		data: results.map((row) => ({
			...row,
			logoUrl: row.logoUrl ?? null,
			primaryColor: row.primaryColor ?? null,
			accentColor: row.accentColor ?? null,
			ownerEmail: row.ownerEmail ?? null,
			firstParty: isFirstParty(c, { id: row.id, ownerId: row.ownerId }),
			pendingChange: parseRequest(row.pendingChange),
			reviewedAt: row.reviewedAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
		})),
	}, 200);
});

// ============================================================
// A change request: the developer withdraws it, or a reviewer decides
// ============================================================

const CHANGE_GONE = "The request changed. Look again.";

const withdrawChangeRoute = createRoute({
	operationId: "withdrawAppChange",
	method: "delete",
	path: "/apps/{id}/change/{changeId}",
	tags: ["Auth"],
	summary: "Withdraw a change request (owner)",
	request: { params: z.object({ id: z.string(), changeId: z.string().max(64) }) },
	responses: {
		204: { description: "Withdrawn" },
		403: { description: "Not the owner", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "App not found", content: { "application/json": { schema: ErrorResponse } } },
		409: Conflict,
	},
});

authRoute.openapi(withdrawChangeRoute, async (c) => {
	const user = getUser(c);
	const { id, changeId } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);
	if (app.ownerId !== user.id && !isAdmin(c, user.id)) {
		return problemJson(c, 403, "You do not own this app.");
	}
	const request = parseRequest(app.pendingChange);
	if (!(await withdrawChange(db, id, changeId))) return problemJson(c, 409, CHANGE_GONE);
	if (request?.id === changeId) await removeLogoFile(c.env?.APP_LOGOS, id, request.logoUrl);
	return c.body(null, 204);
});

const decideChangeRoute = createRoute({
	operationId: "adminDecideAppChange",
	method: "post",
	path: "/apps/{id}/change/{changeId}/decision",
	tags: ["Auth"],
	summary: "Approve or decline a change request (admin-only)",
	request: {
		params: z.object({ id: z.string(), changeId: z.string().max(64) }),
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z.object({
						decision: z.enum(["approve", "decline"]),
						note: z.string().trim().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Decided",
			content: {
				"application/json": {
					schema: z.object({ data: z.object({ id: z.string(), decision: z.string() }) }),
				},
			},
		},
		400: BadRequest,
		403: { description: "Admin access required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "App not found", content: { "application/json": { schema: ErrorResponse } } },
		409: Conflict,
	},
});

authRoute.openapi(decideChangeRoute, async (c) => {
	const user = getUser(c);
	if (!isAdmin(c, user.id)) return problemJson(c, 403, "Admin access required.");
	const { id, changeId } = c.req.valid("param");
	const body = c.req.valid("json");
	const needsNote = noteProblem(body.decision, body.note);
	if (needsNote) return problemJson(c, 400, needsNote);

	const { db } = getDb(c.env?.HYPERDRIVE);
	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);

	// The reviewer decides on the request that the screen showed. The id of a request is new for each
	// change of its content, so the statement below applies exactly what was read here, or nothing.
	const request = parseRequest(app.pendingChange);
	if (!request || request.id !== changeId) return problemJson(c, 409, CHANGE_GONE);
	const live = {
		name: app.name,
		redirectUris: app.redirectUris,
		scopes: app.scopes,
		logoUrl: app.logoUrl ?? null,
	};
	const done =
		body.decision === "approve"
			? await decideChange(db, id, changeId, {
					decision: "approve",
					values: applyRequest(live, request),
				})
			: await decideChange(db, id, changeId, { decision: "decline", note: body.note ?? "" });
	if (!done) return problemJson(c, 409, CHANGE_GONE);

	if (body.decision === "approve") {
		// The old logo, when the approval put a new one in its place.
		if (request.logoUrl && request.logoUrl !== app.logoUrl) {
			await removeLogoFile(c.env?.APP_LOGOS, id, app.logoUrl);
		}
		// A code that waits was made for the old permissions.
		if (request.scopes) await db.delete(authCodes).where(eq(authCodes.appId, id));
	} else {
		await removeLogoFile(c.env?.APP_LOGOS, id, request.logoUrl);
	}

	c.get("logger")?.info(`[auth] change of app "${id}": ${body.decision}`, { adminId: user.id });

	if (app.ownerId && app.ownerId !== user.id) {
		const [owner] = await db
			.select({ email: users.email })
			.from(users)
			.where(eq(users.id, app.ownerId))
			.limit(1);
		await sendMail(mailEnv(c), owner?.email, changeMail(app, body.decision, body.note ?? null));
	}

	return c.json({ data: { id, decision: body.decision } }, 200);
});

// ============================================================
// PATCH /apps/:id/status — An admin approves, declines, or suspends an app
// ============================================================

const AppStatusBody = z.object({
	status: z.enum(["approved", "declined", "suspended", "pending"]),
	// A note to the developer.
	note: z.string().trim().max(1000).optional(),
	// What the reviewer's screen showed. Needed for an approval: an app in review is live for its owner
	// at once, so its owner can change it while the reviewer reads.
	seen: z
		.object({
			name: z.string(),
			redirectUris: z.array(z.string()),
			scopes: z.array(z.string()),
			logoUrl: z.string().nullable(),
		})
		.optional(),
});

const setAppStatusRoute = createRoute({
	operationId: "adminSetAppStatus",
	method: "patch",
	path: "/apps/{id}/status",
	tags: ["Auth"],
	summary: "Approve, decline, or suspend an app (admin-only)",
	request: {
		params: z.object({ id: z.string() }),
		body: { content: { "application/json": { schema: AppStatusBody } }, required: true },
	},
	responses: {
		200: {
			description: "The new status",
			content: {
				"application/json": {
					schema: z.object({ data: z.object({ id: z.string(), status: z.string() }) }),
				},
			},
		},
		400: BadRequest,
		409: Conflict,
		403: {
			description: "Admin access required",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "App not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

authRoute.openapi(setAppStatusRoute, async (c) => {
	const user = getUser(c);
	if (!isAdmin(c, user.id)) return problemJson(c, 403, "Admin access required.");

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
	if (!app) return problemJson(c, 404, `App "${id}" not found.`);

	// A developer who is declined or suspended must be told why.
	const needsNote = noteProblem(body.status, body.note);
	if (needsNote) return problemJson(c, 400, needsNote);

	// The reviewer approves what the screen showed, or is told that the app changed.
	const CHANGED = "The app changed since you looked. Look again.";
	if (body.status === "approved") {
		if (!body.seen) return problemJson(c, 400, "Say what the screen showed (seen).");
		const now = { name: app.name, redirectUris: app.redirectUris, scopes: app.scopes, logoUrl: app.logoUrl ?? null };
		if (!sameAsSeen(now, body.seen)) return problemJson(c, 409, CHANGED);
	}

	// The status first. Each request of the app, each refresh, and each sign-in reads it, so the app
	// stops with this one statement. The two deletes after it only clean up.
	// An approval holds only if the row is still what the reviewer saw at the moment of the write.
	const written = await setReviewStatus(db, id, {
		status: body.status,
		note: body.note || null,
		seen: body.seen,
	});
	if (!written) return problemJson(c, 409, CHANGED);

	if (body.status === "suspended") {
		await db.delete(refreshTokens).where(eq(refreshTokens.appId, id));
		await db.delete(authCodes).where(eq(authCodes.appId, id));
	}

	c.get("logger")?.info(`[auth] app "${id}" is now ${body.status}`, { adminId: user.id });

	if (app.ownerId && app.ownerId !== user.id) {
		const [owner] = await db
			.select({ email: users.email })
			.from(users)
			.where(eq(users.id, app.ownerId))
			.limit(1);
		await sendMail(mailEnv(c), owner?.email, decisionMail(app, body.status, body.note ?? null));
	}

	return c.json({ data: { id, status: body.status } }, 200);
});
