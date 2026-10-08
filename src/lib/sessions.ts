import {
	REFRESH_TOKEN_MS,
	signAccessToken,
	signSignOutToken,
	type TokenEnv,
} from "./app-tokens.ts";
import type { AuthStore } from "./auth-store.ts";

// The rules of a session: one sign-in on one device is one family of refresh tokens.
// Each refresh gives a new token and uses up the old one.

// Two tabs can refresh with one token at the same moment. Inside this time a used token is not a theft.
const REUSE_GRACE_MS = 10_000;
// Used tokens are kept this long, so that a late return of one can end the family.
const KEEP_CONSUMED_MS = 60 * 60 * 1000;

export type Tokens = {
	accessToken: string;
	refreshToken: string;
	userId: string;
	email: string | null;
	scopes: string[];
	expiresAt: string;
};

export type RefreshResult =
	| { ok: true; tokens: Tokens }
	| { ok: false; status: 401; detail: string };

export async function sha256(input: string): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function makePair(
	store: AuthStore,
	env: TokenEnv,
	input: {
		userId: string;
		appId: string;
		scopes: string[];
		email: string | null;
		familyId: string;
	},
	now: Date,
): Promise<Tokens> {
	const { token: accessToken, expiresAt } = await signAccessToken(
		{ sub: input.userId, email: input.email, scopes: input.scopes, app_id: input.appId },
		env,
		now,
	);
	// The database keeps only a hash. The token itself is given one time, here.
	const refreshToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
	await store.insertRefreshToken({
		userId: input.userId,
		appId: input.appId,
		tokenHash: await sha256(refreshToken),
		familyId: input.familyId,
		expiresAt: new Date(now.getTime() + REFRESH_TOKEN_MS),
	});
	return {
		accessToken,
		refreshToken,
		userId: input.userId,
		email: input.email,
		scopes: input.scopes,
		expiresAt: expiresAt.toISOString(),
	};
}

// A new sign-in: a new family.
export function issueSession(
	store: AuthStore,
	env: TokenEnv,
	input: { userId: string; appId: string; scopes: string[]; email: string | null },
	now: Date = new Date(),
): Promise<Tokens> {
	return makePair(store, env, { ...input, familyId: crypto.randomUUID() }, now);
}

const refused = (detail: string): RefreshResult => ({ ok: false, status: 401, detail });

export async function refreshSession(
	store: AuthStore,
	env: TokenEnv,
	input: { appId: string; refreshToken: string },
	now: Date = new Date(),
): Promise<RefreshResult> {
	const row = await store.findRefreshToken(await sha256(input.refreshToken), input.appId);
	if (!row) return refused("Invalid refresh token.");

	// A token from before families existed gets one now, so the rules below hold for it too.
	const familyId = row.familyId ?? crypto.randomUUID();
	if (!row.familyId) await store.setFamily(row.id, familyId);

	if (row.expiresAt < now) {
		await store.deleteRefreshToken(row.id);
		return refused("Refresh token has expired. Please sign in again.");
	}

	// A used token that returns late is a sign of theft: end the whole sign-in.
	const usedAt = row.consumed ?? ((await store.markConsumed(row.id, now)) ? null : now);
	if (usedAt && now.getTime() - usedAt.getTime() > REUSE_GRACE_MS) {
		await store.deleteFamily(familyId);
		return refused("Refresh token has already been used. This sign-in has ended.");
	}

	// The reader can change or remove what this app can do. A refresh follows that at once.
	const scopes = await store.consentedScopes(row.userId, row.appId);
	if (!scopes) {
		await store.deleteFamily(familyId);
		return refused("The reader removed this app. Please sign in again.");
	}

	const tokens = await makePair(
		store,
		env,
		{
			userId: row.userId,
			appId: row.appId,
			scopes,
			email: await store.userEmail(row.userId),
			familyId,
		},
		now,
	);
	await store.deleteConsumedBefore(familyId, new Date(now.getTime() - KEEP_CONSUMED_MS));
	return { ok: true, tokens };
}

// Ends one sign-in. The answer is the same for a token that is not known, so it tells nothing.
export async function revokeSession(
	store: AuthStore,
	env: TokenEnv,
	input: { appId: string; refreshToken: string },
	now: Date = new Date(),
): Promise<{ signOutToken: string | null }> {
	const row = await store.findRefreshToken(await sha256(input.refreshToken), input.appId);
	if (!row) return { signOutToken: null };
	if (row.familyId) await store.deleteFamily(row.familyId);
	else await store.deleteRefreshToken(row.id);
	return {
		signOutToken: await signSignOutToken({ userId: row.userId, appId: row.appId }, env, now),
	};
}
