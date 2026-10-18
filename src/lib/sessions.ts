import { canUseApp } from "./app-status.ts";
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
// Used tokens are kept this long, so that a late return of one can end the family. The newest used
// token of a family stays longer, so a lost answer can be recovered (see refreshSession).
const KEEP_CONSUMED_MS = 60 * 60 * 1000;
// A lost answer can be recovered this long after the token was used: a night, or a week away.
const RECOVER_MS = 7 * 24 * 60 * 60 * 1000;

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

// The reader does not allow this app now, so no token can be made for it.
export class AccessRemoved extends Error {
	constructor() {
		super("The reader removed this app.");
		this.name = "AccessRemoved";
	}
}

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
	// The token names its family. So a used token that returns is seen as that, also after its own row is removed.
	const refreshToken = `${input.familyId}.${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
		"-",
		"",
	);
	// The store keeps the token only if the reader allows the app at that moment. A removal that runs
	// at the same time must not leave a token behind: a later "Allow" would bring it back to life.
	const kept = await store.insertRefreshToken({
		userId: input.userId,
		appId: input.appId,
		tokenHash: await sha256(refreshToken),
		familyId: input.familyId,
		expiresAt: new Date(now.getTime() + REFRESH_TOKEN_MS),
	});
	if (!kept) throw new AccessRemoved();
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

// The family that a token names, or null for a token from before families existed.
function familyOf(refreshToken: string): string | null {
	const hex = refreshToken.split(".")[0] ?? "";
	if (!refreshToken.includes(".") || !/^[0-9a-f]{32}$/.test(hex)) return null;
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function refreshSession(
	store: AuthStore,
	env: TokenEnv,
	input: { appId: string; refreshToken: string },
	now: Date = new Date(),
): Promise<RefreshResult> {
	const tokenHash = await sha256(input.refreshToken);
	const row = await store.findRefreshToken(tokenHash, input.appId);
	if (!row) {
		// Not known, but it names a family: an old token of that family, used again. End that sign-in.
		// The family id is a random secret that only its own tokens hold, and the app must match too.
		const family = familyOf(input.refreshToken);
		if (family) await store.deleteFamilyOfApp(family, input.appId);
		return refused("Invalid refresh token.");
	}

	if (row.expiresAt < now) {
		// A used token that ended (a recovered one) and returns is a late used token: end the sign-in.
		if (row.consumed && row.familyId) {
			await store.deleteFamily(row.familyId);
			return refused("Refresh token has already been used. This sign-in has ended.");
		}
		await store.deleteRefreshToken(row.id);
		return refused("Refresh token has expired. Please sign in again.");
	}

	// A used token that returns late is a sign of theft: end the whole sign-in. But when no token of the
	// family was used after it, the answer of its refresh never reached the app (a closed page, a sleep):
	// the app still holds this token and nothing else, so it gets a new pair. Once per token, and only
	// inside RECOVER_MS. The claim is one statement, so replays at the same moment start one recovery;
	// the others arrive inside the grace time of the claim, as two tabs do.
	const usedAt = row.consumed ?? ((await store.markConsumed(row.id, now)) ? null : now);
	const late = usedAt !== null && now.getTime() - usedAt.getTime() > REUSE_GRACE_MS;
	const recoverable =
		late &&
		row.familyId !== null &&
		now.getTime() - usedAt.getTime() < RECOVER_MS &&
		!(await store.usedSince(row.familyId, usedAt));
	let recovered = false;
	if (recoverable) {
		const ends = new Date(now.getTime() + REUSE_GRACE_MS);
		recovered = await store.reclaimConsumed(row.id, usedAt, now, ends);
		if (!recovered) {
			// Another request claimed it a moment ago. Inside the grace time of that claim, this is a second tab.
			const again = await store.findRefreshToken(tokenHash, input.appId);
			recovered = !!again?.consumed && now.getTime() - again.consumed.getTime() <= REUSE_GRACE_MS;
		}
	}
	if (late && !recovered) {
		// A token from before families existed has no family to end. End each sign-in of this reader in
		// this app, as the old code did.
		if (row.familyId) await store.deleteFamily(row.familyId);
		else await store.deleteForUserAndApp(row.userId, row.appId);
		return refused("Refresh token has already been used. This sign-in has ended.");
	}

	// A token from before families existed gets a family now.
	const familyId = row.familyId ?? crypto.randomUUID();
	if (!row.familyId) await store.setFamily(row.id, familyId);

	// An app that an admin suspended, or that is not approved yet, gets no new token for other readers.
	const access = await store.appAccess(row.appId);
	if (!access || !canUseApp(access, row.userId)) {
		await store.deleteFamily(familyId);
		return refused("This app is not open. Please sign in again later.");
	}

	// The reader can change or remove what this app can do. A refresh follows that at once.
	const scopes = await store.consentedScopes(row.userId, row.appId);
	if (!scopes) {
		await store.deleteFamily(familyId);
		return refused("The reader removed this app. Please sign in again.");
	}

	let tokens: Tokens;
	try {
		tokens = await makePair(
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
	} catch (error) {
		if (!(error instanceof AccessRemoved)) throw error;
		await store.deleteFamily(familyId);
		return refused("The reader removed this app. Please sign in again.");
	}
	await store.deleteConsumedBefore(familyId, new Date(now.getTime() - KEEP_CONSUMED_MS));
	return { ok: true, tokens };
}

// Ends one sign-in. A token that is not known ends nothing and gets no sign-out token.
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
