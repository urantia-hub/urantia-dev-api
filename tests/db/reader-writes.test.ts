import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { saveBookmark, updateNote } from "../../src/lib/reader-writes.ts";

// The real statements on a real Postgres of this machine. See tests/db/account-store.test.ts.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const ME = "00000000-0000-4000-8000-0000000000d1";
const MARK = {
	userId: ME,
	paragraphId: "3:92.6.14",
	paperId: "92",
	paperSectionId: "92.6",
	paperSectionParagraphId: "92.6.14",
};

suite("writes that two apps can send at once, on a real database", () => {
	const client = postgres(url, { max: 4, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values({ id: ME, email: "me@example.com" });
	});
	afterAll(() => client.end());

	it("makes one bookmark for many saves at the same moment, and one of them is created", async () => {
		const results = await Promise.all(
			Array.from({ length: 8 }, () => saveBookmark(db as never, MARK)),
		);
		expect(results.filter((r) => r.created)).toHaveLength(1);
		expect(new Set(results.map((r) => r.bookmark.id)).size).toBe(1);
		const rows = await db.select().from(schema.bookmarks);
		expect(rows).toHaveLength(1);
	});

	it("changes only the category on a second save, and keeps it when none is given", async () => {
		const first = await saveBookmark(db as never, { ...MARK, category: "Study" });
		const again = await saveBookmark(db as never, MARK);
		expect(again.created).toBe(false);
		expect(again.bookmark.id).toBe(first.bookmark.id);
		expect(again.bookmark.category).toBe("Study");
		const moved = await saveBookmark(db as never, { ...MARK, category: "Favorites" });
		expect(moved.bookmark.category).toBe("Favorites");
		const cleared = await saveBookmark(db as never, { ...MARK, category: null });
		expect(cleared.bookmark.category).toBeNull();
	});

	it("changes a note only when it is unchanged since the updatedAt that was read", async () => {
		const [note] = await db
			.insert(schema.notes)
			.values({ ...MARK, text: "first" })
			.returning();
		if (!note) throw new Error("no note");
		// What a client reads: the API shows milliseconds.
		const read = new Date(note.updatedAt.toISOString());

		const mine = await updateNote(db as never, ME, note.id, { text: "from the Hub" }, read);
		expect(mine.status).toBe("updated");

		const late = await updateNote(db as never, ME, note.id, { text: "from another app" }, read);
		expect(late.status).toBe("changed");
		if (late.status === "changed") expect(late.note.text).toBe("from the Hub");

		const blind = await updateNote(db as never, ME, note.id, { text: "no check" });
		expect(blind.status).toBe("updated");

		const other = "00000000-0000-4000-8000-0000000000ff";
		expect((await updateNote(db as never, ME, other, { text: "x" }, read)).status).toBe("missing");
	});
});
