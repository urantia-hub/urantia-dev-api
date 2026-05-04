// Helpers for the Phase 3 cross-reference feature.
//
// Mirrors `src/lib/entities.ts`: a `wantsBibleParallels` predicate for the
// `?include=` query param and an `enrichWithBibleParallels` batch loader
// that hangs Bible-parallel data off paragraph response rows.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { bibleChunks, bibleParallels } from "../db/schema.ts";
import { formatBibleReference } from "./bible-canonicalizer.ts";

type Db = ReturnType<typeof getDb>["db"];
type ParagraphRow = { id: string; [key: string]: unknown };

export type BibleParallel = {
	chunkId: string; // OSIS-style: "Gen.1.1-2"
	reference: string; // Display: "Genesis 1:1-2"
	bookCode: string;
	chapter: number;
	verseStart: number;
	verseEnd: number;
	text: string;
	similarity: number;
	rank: number;
	source: string;
	embeddingModel: string;
};

/** Check if `include` query param contains "bibleParallels" */
export function wantsBibleParallels(include: string | undefined): boolean {
	if (!include) return false;
	return include
		.split(",")
		.map((s) => s.trim())
		.includes("bibleParallels");
}

/**
 * Batch-enrich paragraph rows with their top-10 Bible parallels (UB → Bible
 * direction). Joins `bible_parallels` to `bible_chunks` to return both the
 * similarity score and the chunk's text.
 */
export async function enrichWithBibleParallels<T extends ParagraphRow>(
	db: Db,
	rows: T[],
): Promise<(T & { bibleParallels: BibleParallel[] })[]> {
	if (rows.length === 0) return [];

	const paragraphIds = rows.map((r) => r.id);

	const junctionRows = await db
		.select({
			paragraphId: bibleParallels.paragraphId,
			chunkId: bibleChunks.id,
			bookCode: bibleChunks.bookCode,
			chapter: bibleChunks.chapter,
			verseStart: bibleChunks.verseStart,
			verseEnd: bibleChunks.verseEnd,
			text: bibleChunks.text,
			similarity: bibleParallels.similarity,
			rank: bibleParallels.rank,
			source: bibleParallels.source,
			embeddingModel: bibleParallels.embeddingModel,
		})
		.from(bibleParallels)
		.innerJoin(bibleChunks, eq(bibleParallels.bibleChunkId, bibleChunks.id))
		.where(
			and(
				inArray(bibleParallels.paragraphId, paragraphIds),
				eq(bibleParallels.direction, "ub_to_bible"),
			),
		)
		.orderBy(asc(bibleParallels.paragraphId), asc(bibleParallels.rank));

	const byParagraph = new Map<string, BibleParallel[]>();
	for (const row of junctionRows) {
		const list = byParagraph.get(row.paragraphId) ?? [];
		const reference =
			formatBibleReference(row.bookCode, row.chapter, row.verseStart) ??
			`${row.bookCode} ${row.chapter}:${row.verseStart}`;
		const fullRef =
			row.verseEnd === row.verseStart ? reference : `${reference}-${row.verseEnd}`;
		list.push({
			chunkId: row.chunkId,
			reference: fullRef,
			bookCode: row.bookCode,
			chapter: row.chapter,
			verseStart: row.verseStart,
			verseEnd: row.verseEnd,
			text: row.text,
			similarity: row.similarity,
			rank: row.rank,
			source: row.source,
			embeddingModel: row.embeddingModel,
		});
		byParagraph.set(row.paragraphId, list);
	}

	return rows.map((r) => ({
		...r,
		bibleParallels: byParagraph.get(r.id) ?? [],
	}));
}
