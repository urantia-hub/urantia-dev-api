import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import {
	consentNow,
	createAccountStore,
	createUserRow,
	isDeleted,
} from "../../src/lib/account-store.ts";
import { createAuthStore } from "../../src/lib/auth-store.ts";
import { deleteAccount, READER_TABLES, removeAccess } from "../../src/lib/consents.ts";

// These tests run the real queries on a real Postgres. They run only against a database on this
// machine that TEST_DATABASE_URL names, with the schema pushed to it. They never use DATABASE_URL.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const FAMILY = "00000000-0000-4000-8000-0000000000f1";

suite("the account queries, on a real database", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const second = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });
	const db2 = drizzle(second, { schema });
	const auth = createAuthStore(db as never);
	const account = createAccountStore(db as never);

	const token = (userId: string, appId: string, hash: string) => ({
		userId,
		appId,
		tokenHash: hash,
		familyId: FAMILY,
		expiresAt: new Date("2027-01-02T03:04:05.000Z"),
	});
	const count = async (table: string, userId: string) => {
		const rows = await db.execute(
			sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${userId}::uuid`,
		);
		return Number(rows[0]?.n);
	};

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values([
			{ id: ME, email: "me@example.com" },
			{ id: OTHER, email: "other@example.com" },
		]);
		await db.insert(schema.apps).values([
			{
				id: "voices",
				name: "Voices",
				secretHash: "x",
				redirectUris: ["https://v/cb"],
				scopes: ["profile"],
				ownerId: OTHER,
				status: "approved",
			},
			{
				id: "log",
				name: "Log",
				secretHash: "x",
				redirectUris: ["https://l/cb"],
				scopes: ["profile"],
				ownerId: OTHER,
				status: "approved",
			},
		]);
		await db.insert(schema.userConsents).values([
			{ userId: ME, appId: "voices", scopes: ["profile"] },
			{ userId: ME, appId: "log", scopes: ["profile"] },
			{ userId: OTHER, appId: "voices", scopes: ["profile"] },
		]);
	});

	afterAll(async () => {
		await client.end();
		await second.end();
	});

	// An id can be registered again after a delete. The new app must not get the old app's data.
	it("removes what readers stored for an app when the app is deleted, and nothing else", async () => {
		await db.insert(schema.userPreferences).values([
			{
				userId: ME,
				preferences: {
					"app:voices:theme": "dark",
					"app:voices2:theme": "light",
					"hub.place": { paperId: "2" },
				},
			},
			{ userId: OTHER, preferences: { "app:voices:only": 1 } },
		]);
		await account.deleteApp("voices");
		const rows = await db.execute(
			sql`select user_id, preferences from user_preferences order by user_id`,
		);
		expect(rows.map((row) => row.preferences)).toEqual([
			{ "app:voices2:theme": "light", "hub.place": { paperId: "2" } },
			{},
		]);
		expect(await db.execute(sql`select 1 from apps where id = 'voices'`)).toHaveLength(0);
		// A second run changes nothing and does not fail.
		await account.deleteApp("voices");
	});

	describe("a refresh token", () => {
		it("is stored when the reader allows the app, with the moment that was given", async () => {
			expect(await auth.insertRefreshToken(token(ME, "voices", "h1"))).toBe(true);
			const row = await auth.findRefreshToken("h1", "voices");
			expect(row?.userId).toBe(ME);
			expect(row?.familyId).toBe(FAMILY);
			expect(row?.expiresAt.toISOString()).toBe("2027-01-02T03:04:05.000Z");
		});

		it("is not stored when the reader does not allow the app", async () => {
			await removeAccess(account, ME, "voices");
			expect(await auth.insertRefreshToken(token(ME, "voices", "h2"))).toBe(false);
			expect(await auth.findRefreshToken("h2", "voices")).toBeNull();
		});

		// The race: a removal is in progress, and a token exchange arrives at the same moment.
		it("waits for a removal that is in progress, and then is not stored", async () => {
			const seen: { stored: boolean | "waiting" } = { stored: "waiting" };
			await second.begin(async (tx) => {
				await tx`delete from user_consents where user_id = ${ME} and app_id = 'voices'`;
				const insert = auth.insertRefreshToken(token(ME, "voices", "h3")).then((kept) => {
					seen.stored = kept;
					return kept;
				});
				await new Promise((resolve) => setTimeout(resolve, 300));
				// The insert must not finish while the removal holds the consent row.
				expect(seen.stored).toBe("waiting");
				await tx`delete from refresh_tokens where user_id = ${ME} and app_id = 'voices'`;
				// The removal commits when this block ends. The insert goes on after it.
				void insert;
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(seen.stored).toBe(false);
			expect(await count("refresh_tokens", ME)).toBe(0);
		});

		// The other order: the token is stored first. The removal must then see it and delete it.
		it("is deleted by a removal that starts while the insert is not committed", async () => {
			let removed = false;
			await second.begin(async (tx) => {
				await tx`
					with allowed as (select 1 from user_consents where user_id = ${ME} and app_id = 'voices' for key share)
					insert into refresh_tokens (user_id, app_id, token_hash, family_id, expires_at)
					select ${ME}::uuid, 'voices', 'h4', ${FAMILY}::uuid, now() + interval '1 day' from allowed`;
				const removal = removeAccess(account, ME, "voices").then(() => {
					removed = true;
				});
				await new Promise((resolve) => setTimeout(resolve, 300));
				expect(removed).toBe(false);
				void removal;
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(removed).toBe(true);
			expect(await count("refresh_tokens", ME)).toBe(0);
			expect(await consentNow(db as never, ME, "voices")).toBeNull();
		});
	});

	describe("remove the access of one app", () => {
		it("removes the consent, the tokens, and the waiting codes of that app for that reader only", async () => {
			await auth.insertRefreshToken(token(ME, "voices", "a"));
			await auth.insertRefreshToken(token(ME, "log", "b"));
			await auth.insertRefreshToken(token(OTHER, "voices", "c"));
			await db.insert(schema.authCodes).values([
				{
					code: "c1",
					appId: "voices",
					userId: ME,
					scopes: ["profile"],
					redirectUri: "https://v/cb",
					expiresAt: new Date(Date.now() + 60_000),
				},
				{
					code: "c2",
					appId: "log",
					userId: ME,
					scopes: ["profile"],
					redirectUri: "https://l/cb",
					expiresAt: new Date(Date.now() + 60_000),
				},
			]);
			await removeAccess(account, ME, "voices");
			expect(await consentNow(db as never, ME, "voices")).toBeNull();
			expect(await consentNow(db as never, ME, "log")).toEqual(["profile"]);
			expect(await consentNow(db as never, OTHER, "voices")).toEqual(["profile"]);
			expect(await auth.findRefreshToken("a", "voices")).toBeNull();
			expect(await auth.findRefreshToken("b", "log")).not.toBeNull();
			expect(await auth.findRefreshToken("c", "voices")).not.toBeNull();
			expect(await count("auth_codes", ME)).toBe(1);
		});
	});

	describe("the apps that a reader owns", () => {
		it("counts the other readers who allowed each app, without the owner", async () => {
			await db
				.insert(schema.userConsents)
				.values({ userId: OTHER, appId: "log", scopes: ["profile"] });
			const owned = await account.ownedApps(OTHER);
			expect(owned.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
				{ id: "log", name: "Log", status: "approved", otherUsers: 1 },
				{ id: "voices", name: "Voices", status: "approved", otherUsers: 1 },
			]);
			expect(await account.ownedApps(ME)).toEqual([]);
		});
	});

	describe("the marker of a deleted account", () => {
		const NEW = "00000000-0000-4000-8000-0000000000a9";
		const row = { id: NEW, email: "new@example.com", name: null, avatarUrl: null };

		it("makes the row of a new reader, one time", async () => {
			await createUserRow(db as never, row);
			await createUserRow(db as never, row);
			expect(
				(await db.execute(sql`select email from users where id = ${NEW}::uuid`))[0]?.email,
			).toBe("new@example.com");
		});

		it("makes no row for an account that is marked as deleted", async () => {
			await account.markDeleted(NEW);
			await account.markDeleted(NEW);
			expect(await isDeleted(db as never, NEW)).toBe(true);
			expect(await isDeleted(db as never, ME)).toBe(false);
			await createUserRow(db as never, row);
			expect(await db.execute(sql`select 1 from users where id = ${NEW}::uuid`)).toHaveLength(0);
		});
	});

	describe("delete the account", () => {
		it("removes each row of the reader and keeps each row of another reader", async () => {
			await auth.insertRefreshToken(token(ME, "voices", "a"));
			await auth.insertRefreshToken(token(OTHER, "voices", "c"));
			const place = {
				paragraphId: "1:0.1",
				paperId: "1",
				paperSectionId: "1:0",
				paperSectionParagraphId: "1:0.1",
			};
			await db.insert(schema.bookmarks).values([
				{ userId: ME, ...place },
				{ userId: OTHER, ...place },
			]);
			await db.insert(schema.notes).values({ userId: ME, ...place, text: "a note" });
			await db
				.insert(schema.userPreferences)
				.values({ userId: ME, preferences: { theme: "dark" } });
			// An app of the reader that no other person uses.
			await db.insert(schema.apps).values({
				id: "mine",
				name: "Mine",
				secretHash: "x",
				redirectUris: ["https://m/cb"],
				scopes: ["profile"],
				ownerId: ME,
				status: "pending",
			});

			const removed: string[] = [];
			const result = await deleteAccount(account, {
				userId: ME,
				email: "me@example.com",
				typedEmail: "me@example.com",
				removeSignIn: async (id) => {
					removed.push(id);
				},
			});
			expect(result).toEqual({ ok: true });
			for (const table of READER_TABLES) expect(await count(table, ME)).toBe(0);
			expect(await db.execute(sql`select 1 from users where id = ${ME}::uuid`)).toHaveLength(0);
			expect(await db.execute(sql`select 1 from apps where id = 'mine'`)).toHaveLength(0);
			expect(await isDeleted(db as never, ME)).toBe(true);
			expect(removed).toEqual([ME]);
			// The other reader.
			expect(await count("bookmarks", OTHER)).toBe(1);
			expect(await count("refresh_tokens", OTHER)).toBe(1);
			expect(await consentNow(db as never, OTHER, "voices")).toEqual(["profile"]);
		});

		// A request that passed the check a moment before the mark can still add a row. The removal of
		// the reader's own row must take it too.
		it("leaves no row that arrived behind the delete of its table", async () => {
			const place = {
				paragraphId: "1:0.1",
				paperId: "1",
				paperSectionId: "1:0",
				paperSectionParagraphId: "1:0.1",
			};
			const late = {
				...account,
				deleteRows: async (table: (typeof READER_TABLES)[number], userId: string) => {
					await account.deleteRows(table, userId);
					if (table === "bookmarks")
						await db2.insert(schema.bookmarks).values({ userId: ME, ...place });
				},
			};
			await deleteAccount(late, {
				userId: ME,
				email: "me@example.com",
				typedEmail: "me@example.com",
				removeSignIn: async () => {},
			});
			expect(await count("bookmarks", ME)).toBe(0);
		});

		it("is refused, with nothing removed, for an owner of an approved app that another reader uses", async () => {
			const result = await deleteAccount(account, {
				userId: OTHER,
				email: "other@example.com",
				typedEmail: "other@example.com",
				removeSignIn: async () => {},
			});
			expect(result).toEqual({
				ok: false,
				reason: "apps",
				apps: expect.arrayContaining(["Voices"]),
			});
			expect(await isDeleted(db as never, OTHER)).toBe(false);
			expect(await consentNow(db as never, OTHER, "voices")).toEqual(["profile"]);
		});
	});
});

it("the database tests ran, or say why they did not", () => {
	if (!local)
		console.log("tests/db skipped: TEST_DATABASE_URL does not name a database on this machine");
	expect(true).toBe(true);
});
