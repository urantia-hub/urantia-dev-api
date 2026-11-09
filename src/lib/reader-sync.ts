import { and, count, desc, eq, gte, inArray, lt, min } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { readerDeletions } from "../db/schema.ts";

// ?since= on /me/bookmarks and /me/notes: the items that changed after a time, and the ids of
// the items that the reader deleted after it. The rules here are pure; the statements follow.

type Db = ReturnType<typeof getDb>["db"];
export type DeletionKind = "bookmark" | "note";

// How long a delete is kept. A since older than this cannot list each delete, so it is refused.
export const READER_DELETIONS_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// The most deletes kept for one reader and one kind. A delete past this removes the oldest, so a
// loop of add and delete cannot grow the table or the deleted list without end.
export const READER_DELETIONS_MAX = 1000;

// syncedAt is this much before the time of the read, so a write that ends during the read comes
// again in the next sync. An item can come two times; a client keeps one item for each id.
export const SYNC_OVERLAP_MS = 10_000;

export function syncedAtFor(now: Date): Date {
	return new Date(now.getTime() - SYNC_OVERLAP_MS);
}

// Why this since cannot be used, or null if it can. A time in the future is a client clock error.
// 410: the deletes before the window are gone, so the client must get the full list again.
export function sinceProblem(since: Date, now: Date): { status: 400 | 410; detail: string } | null {
	if (Number.isNaN(since.getTime()))
		return { status: 400, detail: "since must be an ISO 8601 time." };
	if (since.getTime() > now.getTime()) return { status: 400, detail: "since is in the future." };
	if (now.getTime() - since.getTime() > READER_DELETIONS_DAYS * DAY_MS)
		return {
			status: 410,
			detail: `since is more than ${READER_DELETIONS_DAYS} days ago. Get the full list again, without since.`,
		};
	return null;
}

// Records a delete, and removes the deletes of this reader that are older than the window or
// past READER_DELETIONS_MAX. Call it in the transaction of the delete, so a delete has its record.
export async function recordDeletion(
	tx: Pick<Db, "insert" | "delete" | "select">,
	row: { userId: string; kind: DeletionKind; itemId: string; paragraphId: string },
	now: Date = new Date(),
): Promise<void> {
	await tx.insert(readerDeletions).values(row);
	const oldest = new Date(now.getTime() - READER_DELETIONS_DAYS * DAY_MS);
	await tx
		.delete(readerDeletions)
		.where(and(eq(readerDeletions.userId, row.userId), lt(readerDeletions.deletedAt, oldest)));
	const past = tx
		.select({ id: readerDeletions.id })
		.from(readerDeletions)
		.where(and(eq(readerDeletions.userId, row.userId), eq(readerDeletions.kind, row.kind)))
		.orderBy(desc(readerDeletions.deletedAt), desc(readerDeletions.id))
		.offset(READER_DELETIONS_MAX);
	await tx.delete(readerDeletions).where(inArray(readerDeletions.id, past));
}

// A 410 problem when the kept deletes are full and since is before the oldest of them: deletes
// before that can be gone. With fewer than READER_DELETIONS_MAX kept, nothing was removed.
export async function trimmedSinceProblem(
	db: Db,
	userId: string,
	kind: DeletionKind,
	since: Date,
): Promise<{ status: 410; detail: string } | null> {
	const [kept] = await db
		.select({ total: count(), oldest: min(readerDeletions.deletedAt) })
		.from(readerDeletions)
		.where(and(eq(readerDeletions.userId, userId), eq(readerDeletions.kind, kind)));
	if (!kept || kept.total < READER_DELETIONS_MAX || !kept.oldest) return null;
	if (since.getTime() >= new Date(kept.oldest).getTime()) return null;
	return {
		status: 410,
		detail: `More than ${READER_DELETIONS_MAX} deletes since that time. Get the full list again, without since.`,
	};
}

// The deletes of this kind at or after since, the oldest first.
export async function deletionsSince(
	db: Db,
	userId: string,
	kind: DeletionKind,
	since: Date,
): Promise<Array<{ id: string; paragraphId: string; deletedAt: string }>> {
	const rows = await db
		.select({
			id: readerDeletions.itemId,
			paragraphId: readerDeletions.paragraphId,
			deletedAt: readerDeletions.deletedAt,
		})
		.from(readerDeletions)
		.where(
			and(
				eq(readerDeletions.userId, userId),
				eq(readerDeletions.kind, kind),
				gte(readerDeletions.deletedAt, since),
			),
		)
		.orderBy(readerDeletions.deletedAt);
	return rows.map((r) => ({ ...r, deletedAt: r.deletedAt.toISOString() }));
}
