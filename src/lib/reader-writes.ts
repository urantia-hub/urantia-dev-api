import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { bookmarks, notes } from "../db/schema.ts";

// Writes of /me that two apps, or two taps, can send at the same moment. Each one is a single
// conditional statement, so no request reads a state that another changes before its write.

type Db = ReturnType<typeof getDb>["db"];
type Bookmark = typeof bookmarks.$inferSelect;
type Note = typeof notes.$inferSelect;

export type BookmarkInput = {
	userId: string;
	paragraphId: string;
	paperId: string;
	paperSectionId: string;
	paperSectionParagraphId: string;
	category?: string | null;
};

// A reader has one bookmark for each paragraph, for all apps together: no write sets app_id, so
// the unique index (user, paragraph, app) holds one row. A second save of it changes only a given
// category. created is true only for the request whose insert made the row.
export async function saveBookmark(
	db: Db,
	input: BookmarkInput,
	tries = 3,
): Promise<{ bookmark: Bookmark; created: boolean }> {
	const [inserted] = await db
		.insert(bookmarks)
		.values({ ...input, category: input.category ?? null })
		.onConflictDoNothing({ target: [bookmarks.userId, bookmarks.paragraphId, bookmarks.appId] })
		.returning();
	if (inserted) return { bookmark: inserted, created: true };

	const mine = and(
		eq(bookmarks.userId, input.userId),
		eq(bookmarks.paragraphId, input.paragraphId),
	);
	if (input.category !== undefined) {
		const [changed] = await db
			.update(bookmarks)
			.set({ category: input.category, updatedAt: new Date() })
			.where(and(mine, sql`${bookmarks.category} is distinct from ${input.category}`))
			.returning();
		if (changed) return { bookmark: changed, created: false };
	}
	const [existing] = await db.select().from(bookmarks).where(mine).limit(1);
	// A delete between the insert and this read leaves no row: save it again.
	if (!existing) {
		if (tries <= 1) throw new Error("saveBookmark: the bookmark was deleted at each try");
		return saveBookmark(db, input, tries - 1);
	}
	return { bookmark: existing, created: false };
}

// The time of a note as the API shows it (milliseconds), so a client can send it back as read.
const updatedAtMs = sql`date_trunc('milliseconds', ${notes.updatedAt})`;

// Changes a note. With expectedUpdatedAt (the updatedAt that the client read), the change holds only
// if nobody changed the note since then; otherwise "changed" and the note as it is now.
export async function updateNote(
	db: Db,
	userId: string,
	id: string,
	changes: { text?: string; format?: string },
	expectedUpdatedAt?: Date,
): Promise<
	{ status: "updated"; note: Note } | { status: "changed"; note: Note } | { status: "missing" }
> {
	const mine = and(eq(notes.id, id), eq(notes.userId, userId));
	const unchanged =
		expectedUpdatedAt === undefined
			? mine
			: and(mine, sql`${updatedAtMs} = ${expectedUpdatedAt.toISOString()}::timestamp`);
	const [updated] = await db
		.update(notes)
		.set({ ...changes, updatedAt: new Date() })
		.where(unchanged)
		.returning();
	if (updated) return { status: "updated", note: updated };
	const [current] = await db.select().from(notes).where(mine).limit(1);
	return current ? { status: "changed", note: current } : { status: "missing" };
}
