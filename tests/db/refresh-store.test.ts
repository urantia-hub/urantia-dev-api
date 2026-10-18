import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { createAuthStore } from "../../src/lib/auth-store.ts";

// The real queries on a real Postgres of this machine. See tests/db/account-store.test.ts.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const ME = "00000000-0000-4000-8000-0000000000b1";
const FAMILY = "00000000-0000-4000-8000-0000000000f1";
const OTHER_FAMILY = "00000000-0000-4000-8000-0000000000f2";
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 18, 12, minutes));

suite("the refresh token queries, on a real database", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });
	const store = createAuthStore(db as never);

	const token = (hash: string, familyId: string, consumed: Date | null) =>
		db.insert(schema.refreshTokens).values({
			userId: ME,
			appId: "hub",
			tokenHash: hash,
			familyId,
			consumed,
			expiresAt: at(60 * 24 * 90),
		});

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values({ id: ME, email: "me@example.com" });
		await db.insert(schema.apps).values({
			id: "hub",
			name: "Hub",
			secretHash: "x",
			redirectUris: ["https://hub/cb"],
			scopes: ["profile"],
		});
	});
	afterAll(() => client.end());

	it("tell whether a token of the family was used after a moment", async () => {
		await token("a", FAMILY, at(0));
		await token("b", FAMILY, at(15));
		await token("c", FAMILY, null);
		await token("d", OTHER_FAMILY, at(40));
		expect(await store.usedSince(FAMILY, at(0))).toBe(true);
		expect(await store.usedSince(FAMILY, at(15))).toBe(false);
		expect(await store.usedSince(FAMILY, at(30))).toBe(false);
	});

	it("claim a recovery once, only from the time the token was used", async () => {
		await token("a", FAMILY, at(0));
		const [row] = await db.select().from(schema.refreshTokens);
		if (!row) throw new Error("setup");
		expect(await store.reclaimConsumed(row.id, at(1), at(30), at(31))).toBe(false);
		expect(await store.reclaimConsumed(row.id, at(0), at(30), at(31))).toBe(true);
		expect(await store.reclaimConsumed(row.id, at(0), at(32), at(33))).toBe(false);
		const found = await store.findRefreshToken("a", "hub");
		expect(found?.consumed?.toISOString()).toBe(at(30).toISOString());
		expect(found?.expiresAt.toISOString()).toBe(at(31).toISOString());
	});

	it("remove old used tokens but keep the newest used one", async () => {
		await token("a", FAMILY, at(0));
		await token("b", FAMILY, at(15));
		await token("c", FAMILY, null);
		await token("d", OTHER_FAMILY, at(5));
		await store.deleteConsumedBefore(FAMILY, at(100));
		const left = await db
			.select({ hash: schema.refreshTokens.tokenHash })
			.from(schema.refreshTokens);
		expect(left.map((r) => r.hash).sort()).toEqual(["b", "c", "d"]);
	});
});
