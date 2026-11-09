import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { readExport } from "../../src/lib/reader-export.ts";
import {
	deletionsSince,
	READER_DELETIONS_DAYS,
	recordDeletion,
} from "../../src/lib/reader-sync.ts";

// The real queries on a real Postgres of this machine. See tests/db/account-store.test.ts.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const ME = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const ITEM = "00000000-0000-4000-8000-0000000000c1";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

suite("reader sync and export, on a real database", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values([
			{ id: ME, email: "me@example.com" },
			{ id: OTHER, email: "other@example.com" },
		]);
	});
	afterAll(() => client.end());

	it("lists the deletes of one reader and one kind from a time on", async () => {
		await recordDeletion(db as never, {
			userId: ME,
			kind: "bookmark",
			itemId: ITEM,
			paragraphId: "1:2.0.1",
		});
		await recordDeletion(db as never, {
			userId: ME,
			kind: "note",
			itemId: ITEM,
			paragraphId: "1:2.0.1",
		});
		await recordDeletion(db as never, {
			userId: OTHER,
			kind: "bookmark",
			itemId: ITEM,
			paragraphId: "1:2.0.1",
		});

		const mine = await deletionsSince(db as never, ME, "bookmark", daysAgo(1));
		expect(mine).toHaveLength(1);
		expect(mine[0]).toMatchObject({ id: ITEM, paragraphId: "1:2.0.1" });
		expect(
			await deletionsSince(db as never, ME, "bookmark", new Date(Date.now() + 60_000)),
		).toEqual([]);
	});

	// The table must not grow without end. Each delete removes the reader's rows past the window.
	it("removes the deletes of the reader that are older than the window", async () => {
		await db.insert(schema.readerDeletions).values([
			{
				userId: ME,
				kind: "bookmark",
				itemId: ITEM,
				paragraphId: "1:0.1",
				deletedAt: daysAgo(READER_DELETIONS_DAYS + 2),
			},
			{
				userId: OTHER,
				kind: "bookmark",
				itemId: ITEM,
				paragraphId: "1:0.1",
				deletedAt: daysAgo(READER_DELETIONS_DAYS + 2),
			},
		]);
		await recordDeletion(db as never, {
			userId: ME,
			kind: "note",
			itemId: ITEM,
			paragraphId: "1:0.2",
		});
		const left = await db.select().from(schema.readerDeletions);
		expect(left.filter((r) => r.userId === ME).map((r) => r.paragraphId)).toEqual(["1:0.2"]);
		// Another reader's old row waits for that reader's next delete.
		expect(left.filter((r) => r.userId === OTHER)).toHaveLength(1);
	});

	it("goes when the reader's account goes", async () => {
		await recordDeletion(db as never, {
			userId: ME,
			kind: "bookmark",
			itemId: ITEM,
			paragraphId: "1:0.1",
		});
		await db.delete(schema.users).where(sql`id = ${ME}`);
		expect(await db.select().from(schema.readerDeletions)).toEqual([]);
	});

	it("exports the reader's data and none of the secrets", async () => {
		await db.insert(schema.apps).values({
			id: "my-app",
			name: "My App",
			secretHash: "hash-of-the-app-secret",
			redirectUris: ["https://example.com/cb"],
			scopes: ["bookmarks"],
			ownerId: ME,
		});
		await db.insert(schema.bookmarks).values({
			userId: ME,
			paragraphId: "1:2.0.1",
			paperId: "2",
			paperSectionId: "2:0",
			paperSectionParagraphId: "2.0.1",
			category: "prayer",
		});
		await db.insert(schema.notes).values({
			userId: ME,
			paragraphId: "1:2.0.1",
			paperId: "2",
			paperSectionId: "2:0",
			paperSectionParagraphId: "2.0.1",
			text: "my note",
		});
		await db.insert(schema.notes).values({
			userId: OTHER,
			paragraphId: "1:2.0.1",
			paperId: "2",
			paperSectionId: "2:0",
			paperSectionParagraphId: "2.0.1",
			text: "another reader's note",
		});
		await db.insert(schema.pushSubscriptions).values({
			userId: ME,
			endpoint: "https://fcm.googleapis.com/fcm/send/secret-device",
			p256dh: "BPubKey_device_key",
			auth: "authSecret_device",
			label: "Phone",
		});
		await db.insert(schema.refreshTokens).values({
			userId: ME,
			appId: "my-app",
			tokenHash: "hash-of-a-refresh-token",
			expiresAt: daysAgo(-30),
		});

		const out = await readExport(db as never, ME);
		const text = JSON.stringify(out);
		expect((out.account as { email: string }).email).toBe("me@example.com");
		expect(out.bookmarks).toHaveLength(1);
		expect(out.notes).toHaveLength(1);
		expect(text).toContain("prayer");
		expect(text).toContain("Phone");
		for (const secret of [
			"another reader's note",
			"secret-device",
			"BPubKey_device_key",
			"authSecret_device",
			"hash-of-a-refresh-token",
			"hash-of-the-app-secret",
		])
			expect(text).not.toContain(secret);
	});
});
