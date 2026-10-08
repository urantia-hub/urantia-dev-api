import { beforeAll, describe, expect, it } from "bun:test";
import { decodeJwt, exportJWK, generateKeyPair } from "jose";
import type { AppStatus } from "../../src/lib/app-status.ts";
import { type TokenEnv, verifyAccessToken } from "../../src/lib/app-tokens.ts";
import type { AuthStore, RefreshRow } from "../../src/lib/auth-store.ts";
import {
	AccessRemoved,
	issueSession,
	refreshSession,
	revokeSession,
	sha256,
} from "../../src/lib/sessions.ts";

const USER = "00000000-0000-4000-8000-000000000001";
const APP = "some-app";
const NOW = new Date("2026-10-08T12:00:00Z");
const after = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const DAY = 86_400;

type Row = RefreshRow & { tokenHash: string };

function memoryStore(consents: Record<string, string[] | null> = { [APP]: ["profile", "notes"] }) {
	const rows: Row[] = [];
	const access: { status: AppStatus; ownerId: string | null } = {
		status: "approved",
		ownerId: "owner-1",
	};
	let next = 1;
	// The reader removes the app between the check of the consent and the insert of the token.
	const flags = { removedBeforeInsert: false };
	const store: AuthStore = {
		async findRefreshToken(tokenHash, appId) {
			return rows.find((r) => r.tokenHash === tokenHash && r.appId === appId) ?? null;
		},
		async insertRefreshToken(row) {
			// As the database: the row is stored only if the reader allows the app at that moment.
			if (flags.removedBeforeInsert || !consents[row.appId]) return false;
			rows.push({ ...row, id: `row-${next++}`, consumed: null });
			return true;
		},
		async markConsumed(id, at) {
			const row = rows.find((r) => r.id === id);
			if (!row || row.consumed) return false;
			row.consumed = at;
			return true;
		},
		async setFamily(id, familyId) {
			const row = rows.find((r) => r.id === id);
			if (row) row.familyId = familyId;
		},
		async deleteFamily(familyId) {
			for (let i = rows.length - 1; i >= 0; i--)
				if (rows[i]?.familyId === familyId) rows.splice(i, 1);
		},
		async deleteFamilyOfApp(familyId, appId) {
			for (let i = rows.length - 1; i >= 0; i--) {
				if (rows[i]?.familyId === familyId && rows[i]?.appId === appId) rows.splice(i, 1);
			}
		},
		async deleteForUserAndApp(userId, appId) {
			for (let i = rows.length - 1; i >= 0; i--) {
				if (rows[i]?.userId === userId && rows[i]?.appId === appId) rows.splice(i, 1);
			}
		},
		async deleteRefreshToken(id) {
			const i = rows.findIndex((r) => r.id === id);
			if (i >= 0) rows.splice(i, 1);
		},
		async deleteConsumedBefore(familyId, before) {
			for (let i = rows.length - 1; i >= 0; i--) {
				const row = rows[i];
				if (row?.familyId === familyId && row.consumed && row.consumed < before) rows.splice(i, 1);
			}
		},
		async appAccess() {
			return access;
		},
		async consentedScopes(_userId, appId) {
			return consents[appId] ?? null;
		},
		async userEmail() {
			return "reader@example.com";
		},
	};
	return { store, rows, consents, access, flags };
}

let env: TokenEnv;
beforeAll(async () => {
	const { privateKey } = await generateKeyPair("ES256", { extractable: true });
	env = { APP_JWT_PRIVATE_JWK: JSON.stringify(await exportJWK(privateKey)) };
});

const start = (store: AuthStore, at = NOW) =>
	issueSession(
		store,
		env,
		{ userId: USER, appId: APP, scopes: ["profile", "notes"], email: "reader@example.com" },
		at,
	);

describe("issueSession", () => {
	it("gives a pair, and a new family for each sign-in", async () => {
		const { store, rows } = memoryStore();
		const one = await start(store);
		const two = await start(store);
		expect(one.refreshToken).not.toBe(two.refreshToken);
		expect(rows).toHaveLength(2);
		expect(rows[0]?.familyId).toBeTruthy();
		expect(rows[0]?.familyId).not.toBe(rows[1]?.familyId);
		expect((await verifyAccessToken(one.accessToken, env, NOW)).scopes).toEqual([
			"profile",
			"notes",
		]);
	});

	it("keeps only a hash of the refresh token", async () => {
		const { store, rows } = memoryStore();
		const { refreshToken } = await start(store);
		expect(rows[0]?.tokenHash).toBe(await sha256(refreshToken));
		expect(JSON.stringify(rows)).not.toContain(refreshToken);
	});
});

describe("refreshSession", () => {
	it("gives a new pair and keeps the family", async () => {
		const { store, rows } = memoryStore();
		const first = await start(store);
		const result = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(60),
		);
		if (!result.ok) throw new Error(result.detail);
		expect(result.tokens.refreshToken).not.toBe(first.refreshToken);
		expect(result.tokens.userId).toBe(USER);
		expect(rows[1]?.familyId).toBe(rows[0]?.familyId as string);
		expect(rows[0]?.consumed).toEqual(after(60));
	});

	it("renews the 90 days at each use", async () => {
		const { store, rows } = memoryStore();
		const first = await start(store);
		await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(80 * DAY),
		);
		expect(rows[1]?.expiresAt).toEqual(after(170 * DAY));
	});

	it("refuses a token after its 90 days", async () => {
		const { store, rows } = memoryStore();
		const first = await start(store);
		const result = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(91 * DAY),
		);
		expect(result).toMatchObject({ ok: false, status: 401 });
		expect(rows).toHaveLength(0);
	});

	it("ends the whole family when a used token comes back after the grace time", async () => {
		const { store, rows } = memoryStore();
		const first = await start(store);
		const second = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(60),
		);
		if (!second.ok) throw new Error("setup");
		const replay = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(120),
		);
		expect(replay).toMatchObject({ ok: false, status: 401 });
		expect(rows).toHaveLength(0);
		// The pair that the thief or the reader got from the first use is dead too.
		const dead = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: second.tokens.refreshToken },
			after(130),
		);
		expect(dead.ok).toBe(false);
	});

	// Two tabs of one reader refresh at the same moment with the same token.
	it("answers the second of two requests inside 10 seconds with a new pair, and ends nothing", async () => {
		const { store, rows } = memoryStore();
		const first = await start(store);
		const a = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(60),
		);
		const b = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(65),
		);
		expect(a.ok && b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(a.tokens.refreshToken).not.toBe(b.tokens.refreshToken);
		expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
		const next = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: b.tokens.refreshToken },
			after(600),
		);
		expect(next.ok).toBe(true);
	});

	it("does the same when the two requests arrive at the very same moment", async () => {
		const { store } = memoryStore();
		const first = await start(store);
		const [a, b] = await Promise.all([
			refreshSession(store, env, { appId: APP, refreshToken: first.refreshToken }, after(60)),
			refreshSession(store, env, { appId: APP, refreshToken: first.refreshToken }, after(60)),
		]);
		expect(a.ok && b.ok).toBe(true);
	});

	it("refuses an unknown token, and a token of another app", async () => {
		const { store } = memoryStore({ [APP]: ["profile"], other: ["profile"] });
		const first = await start(store);
		expect(
			await refreshSession(store, env, { appId: APP, refreshToken: "nope" }, NOW),
		).toMatchObject({ ok: false, status: 401 });
		expect(
			await refreshSession(store, env, { appId: "other", refreshToken: first.refreshToken }, NOW),
		).toMatchObject({ ok: false, status: 401 });
	});

	it("gives an old row with no family a family at its first refresh", async () => {
		const { store, rows } = memoryStore();
		rows.push({
			id: "old",
			userId: USER,
			appId: APP,
			familyId: null,
			consumed: null,
			expiresAt: after(DAY),
			tokenHash: await sha256("old-token"),
		});
		const result = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: "old-token" },
			after(60),
		);
		expect(result.ok).toBe(true);
		expect(rows[0]?.familyId).toBeTruthy();
		expect(rows[1]?.familyId).toBe(rows[0]?.familyId as string);
	});

	it("uses the permissions that the reader allows now", async () => {
		const { store, consents } = memoryStore();
		const first = await start(store);
		consents[APP] = ["profile"];
		const result = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(60),
		);
		if (!result.ok) throw new Error("setup");
		expect(result.tokens.scopes).toEqual(["profile"]);
		expect((await verifyAccessToken(result.tokens.accessToken, env, after(61))).scopes).toEqual([
			"profile",
		]);
	});

	// "Remove" on the account page deletes the consent. The app must not get a new token after that.
	it("refuses a refresh after the reader removed the app, and ends the family", async () => {
		const { store, rows, consents } = memoryStore();
		const first = await start(store);
		consents[APP] = null;
		const result = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(60),
		);
		expect(result).toMatchObject({ ok: false, status: 401 });
		expect(rows).toHaveLength(0);
	});

	it("removes used tokens of the family that are older than one hour", async () => {
		const { store, rows } = memoryStore();
		let token = (await start(store)).refreshToken;
		for (const at of [60, 2 * 3600, 4 * 3600]) {
			const result = await refreshSession(
				store,
				env,
				{ appId: APP, refreshToken: token },
				after(at),
			);
			if (!result.ok) throw new Error("setup");
			token = result.tokens.refreshToken;
		}
		// Left: the live token, and the one used at the last refresh.
		expect(rows).toHaveLength(2);
	});
});

describe("an app that other readers cannot use", () => {
	it("gets no new token after an admin suspends it, and the sign-in ends", async () => {
		const { store, rows, access } = memoryStore();
		const first = await start(store);
		access.status = "suspended";
		const result = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(60),
		);
		expect(result).toMatchObject({ ok: false, status: 401 });
		expect(rows).toHaveLength(0);
	});

	// An approved app that changes its name or a return address is pending again.
	it("gets no new token for another reader while it is pending, but its owner goes on", async () => {
		const { store, access } = memoryStore();
		const first = await start(store);
		access.status = "pending";
		expect(
			(
				await refreshSession(
					store,
					env,
					{ appId: APP, refreshToken: first.refreshToken },
					after(60),
				)
			).ok,
		).toBe(false);
		access.ownerId = USER;
		const mine = await start(store);
		expect(
			(await refreshSession(store, env, { appId: APP, refreshToken: mine.refreshToken }, after(60)))
				.ok,
		).toBe(true);
	});

	it("gets no new token when the app is gone", async () => {
		const { store } = memoryStore();
		const first = await start(store);
		store.appAccess = async () => null;
		expect(
			(
				await refreshSession(
					store,
					env,
					{ appId: APP, refreshToken: first.refreshToken },
					after(60),
				)
			).ok,
		).toBe(false);
	});
});

// Findings of the commit scan, 2026-10-08.
describe("a used token that returns", () => {
	// The used rows are removed after one hour. The token still names its family, so the theft is seen.
	it("ends the family also when its own row is long gone", async () => {
		const { store, rows } = memoryStore();
		const first = await start(store);
		// A thief uses the stolen first token and keeps the session alive for hours.
		let thief = first.refreshToken;
		for (const at of [60, 2 * 3600, 4 * 3600, 6 * 3600]) {
			const result = await refreshSession(
				store,
				env,
				{ appId: APP, refreshToken: thief },
				after(at),
			);
			if (!result.ok) throw new Error("setup");
			thief = result.tokens.refreshToken;
		}
		expect(rows.some((r) => r.consumed === null)).toBe(true);
		// The reader returns with the first token. Its row is removed, so the hash is not known.
		const reader = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(7 * 3600),
		);
		expect(reader).toMatchObject({ ok: false, status: 401 });
		expect(rows).toHaveLength(0);
		expect(
			(await refreshSession(store, env, { appId: APP, refreshToken: thief }, after(7 * 3600 + 5)))
				.ok,
		).toBe(false);
	});

	it("does not let a made-up token end the session of another app or of an unknown family", async () => {
		const { store, rows } = memoryStore({ [APP]: ["profile"], other: ["profile"] });
		await start(store);
		// The form in which a token carries its family: no hyphens.
		const family = (rows[0]?.familyId as string).replaceAll("-", "");
		// The family is right, but the app is not the one that owns it.
		await refreshSession(
			store,
			env,
			{ appId: "other", refreshToken: `${family}.made-up` },
			after(60),
		);
		await revokeSession(
			store,
			env,
			{ appId: "other", refreshToken: `${family}.made-up` },
			after(60),
		);
		await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: "0000000000004000800000000000beef.made-up" },
			after(60),
		);
		expect(rows).toHaveLength(1);
		// The same made-up token with the right app does end it: only a holder of a real token knows the family.
		await refreshSession(store, env, { appId: APP, refreshToken: `${family}.made-up` }, after(60));
		expect(rows).toHaveLength(0);
	});

	// A chain from before families existed: the old code ended each session of the reader in that app.
	it("ends each session of the reader in the app when the token is from before families", async () => {
		const { store, rows } = memoryStore();
		rows.push({
			id: "old-used",
			userId: USER,
			appId: APP,
			familyId: null,
			consumed: after(-3600),
			expiresAt: after(DAY),
			tokenHash: await sha256("old-used-token"),
		});
		rows.push({
			id: "old-live",
			userId: USER,
			appId: APP,
			familyId: null,
			consumed: null,
			expiresAt: after(DAY),
			tokenHash: await sha256("old-live-token"),
		});
		const replay = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: "old-used-token" },
			NOW,
		);
		expect(replay).toMatchObject({ ok: false, status: 401 });
		expect(rows).toHaveLength(0);
	});
});

describe("revokeSession", () => {
	it("ends one family and leaves the reader's other device signed in", async () => {
		const { store } = memoryStore();
		const laptop = await start(store);
		const phone = await start(store);
		await revokeSession(store, env, { appId: APP, refreshToken: laptop.refreshToken }, after(60));
		expect(
			(
				await refreshSession(
					store,
					env,
					{ appId: APP, refreshToken: laptop.refreshToken },
					after(70),
				)
			).ok,
		).toBe(false);
		expect(
			(
				await refreshSession(
					store,
					env,
					{ appId: APP, refreshToken: phone.refreshToken },
					after(70),
				)
			).ok,
		).toBe(true);
	});

	it("gives a sign-out token that names the reader and the app, and lives 60 seconds", async () => {
		const { store } = memoryStore();
		const session = await start(store);
		const { signOutToken } = await revokeSession(
			store,
			env,
			{ appId: APP, refreshToken: session.refreshToken },
			NOW,
		);
		const payload = decodeJwt(signOutToken as string);
		expect(payload).toMatchObject({
			sub: USER,
			app_id: APP,
			purpose: "signout",
			iss: "https://accounts.urantiahub.com",
		});
		expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
	});

	// A sign-out token must never work as an access token.
	it("gives a sign-out token that the API does not accept as a sign-in", async () => {
		const { store } = memoryStore();
		const session = await start(store);
		const { signOutToken } = await revokeSession(
			store,
			env,
			{ appId: APP, refreshToken: session.refreshToken },
			NOW,
		);
		await expect(verifyAccessToken(signOutToken as string, env, NOW)).rejects.toThrow();
	});

	it("gives no sign-out token for an unknown token or another app, and ends nothing", async () => {
		const { store, rows } = memoryStore({ [APP]: ["profile"], other: ["profile"] });
		const session = await start(store);
		expect(await revokeSession(store, env, { appId: APP, refreshToken: "nope" }, NOW)).toEqual({
			signOutToken: null,
		});
		expect(
			await revokeSession(store, env, { appId: "other", refreshToken: session.refreshToken }, NOW),
		).toEqual({ signOutToken: null });
		expect(rows).toHaveLength(1);
	});

	it("gives no sign-out token while no signing key is set, and still ends the family", async () => {
		const { store, rows } = memoryStore();
		const session = await issueSession(
			store,
			{ APP_JWT_SECRET: "x".repeat(40) },
			{ userId: USER, appId: APP, scopes: ["profile"], email: null },
			NOW,
		);
		expect(
			await revokeSession(
				store,
				{ APP_JWT_SECRET: "x".repeat(40) },
				{ appId: APP, refreshToken: session.refreshToken },
				NOW,
			),
		).toEqual({ signOutToken: null });
		expect(rows).toHaveLength(0);
	});
});

// "Remove" on the account page and a token exchange can run at the same moment.
// No token must outlive the removal: a later "Allow" would bring it back to life.
describe("a sign-in for an app that the reader removed", () => {
	it("issues nothing, and stores nothing", async () => {
		const { store, rows } = memoryStore({ [APP]: null });
		await expect(start(store)).rejects.toBeInstanceOf(AccessRemoved);
		expect(rows).toHaveLength(0);
	});

	it("refuses a refresh when the app is removed between the check and the insert, and ends the sign-in", async () => {
		const { store, rows, flags } = memoryStore();
		const first = await start(store);
		flags.removedBeforeInsert = true;
		const result = await refreshSession(
			store,
			env,
			{ appId: APP, refreshToken: first.refreshToken },
			after(60),
		);
		expect(result).toEqual({
			ok: false,
			status: 401,
			detail: "The reader removed this app. Please sign in again.",
		});
		expect(rows).toHaveLength(0);
	});
});
