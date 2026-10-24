import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { paragraphFields } from "../routes/paragraphs.ts";
import { detectRefFormat } from "../types/node.ts";

// The full paragraph entity type — same shape as GET /paragraphs/:ref
export type ParagraphEntity = {
	id: string;
	standardReferenceId: string;
	sortId: string;
	paperId: string;
	sectionId: string | null;
	partId: string;
	paperTitle: string;
	sectionTitle: string | null;
	paragraphId: string;
	text: string;
	htmlText: string;
	labels: string[] | null;
	audio: unknown;
};

/**
 * Resolve a paragraph reference (any format) to its full entity + denormalized IDs for storage.
 *
 * Note on IDs:
 * - paragraphs.id = paragraphs.globalId = the globalId (e.g. "1:2.0.1")
 * - paragraphs.paragraphId = the paragraph number within a section (e.g. "1")
 * - paragraphs.paperSectionParagraphId = dot-separated (e.g. "2.0.1")
 * - paragraphs.standardReferenceId = colon-separated (e.g. "2:0.1")
 */
export async function resolveParagraphRef(
	db: ReturnType<typeof getDb>["db"],
	ref: string,
): Promise<{
	globalId: string;
	paperId: string;
	paperSectionId: string;
	paperSectionParagraphId: string;
	paragraph: ParagraphEntity;
} | null> {
	const format = detectRefFormat(ref);
	if (format === "unknown") return null;

	const column =
		format === "globalId"
			? paragraphs.globalId
			: format === "standardReferenceId"
				? paragraphs.standardReferenceId
				: paragraphs.paperSectionParagraphId;

	const [row] = await db
		.select(paragraphFields)
		.from(paragraphs)
		.where(eq(column, ref))
		.limit(1);

	if (!row) return null;

	// paragraphs.id IS the globalId (set in seed.ts: id: p.globalId)
	const globalId = row.id;
	const paperSectionId = row.standardReferenceId.replace(/\.\d+$/, "");

	return {
		globalId,
		paperId: row.paperId,
		paperSectionId,
		paperSectionParagraphId: `${row.paperId}.${row.sectionId ?? "0"}.${row.paragraphId}`,
		paragraph: row as unknown as ParagraphEntity,
	};
}

export interface ParagraphNavigation {
	prev: string | null;
	next: string | null;
}

/**
 * Get the previous and next paragraph refs (standardReferenceId) within the
 * same paper, ordered by sortId. Returns nulls at paper boundaries.
 */
export async function getParagraphNavigation(
	db: ReturnType<typeof getDb>["db"],
	paperId: string,
	sortId: string,
): Promise<ParagraphNavigation> {
	const [prevRows, nextRows] = await Promise.all([
		db
			.select({ standardReferenceId: paragraphs.standardReferenceId })
			.from(paragraphs)
			.where(and(eq(paragraphs.paperId, paperId), lt(paragraphs.sortId, sortId)))
			.orderBy(sql`${paragraphs.sortId} DESC`)
			.limit(1),
		db
			.select({ standardReferenceId: paragraphs.standardReferenceId })
			.from(paragraphs)
			.where(and(eq(paragraphs.paperId, paperId), gt(paragraphs.sortId, sortId)))
			.orderBy(paragraphs.sortId)
			.limit(1),
	]);

	return {
		prev: prevRows[0]?.standardReferenceId ?? null,
		next: nextRows[0]?.standardReferenceId ?? null,
	};
}

/**
 * Look up full paragraph entities for a batch of globalIds.
 * The globalId is stored as paragraphs.id (the PK).
 */
export async function lookupParagraphs(
	db: ReturnType<typeof getDb>["db"],
	globalIds: string[],
): Promise<Map<string, ParagraphEntity>> {
	if (globalIds.length === 0) return new Map();

	// paragraphs.id IS the globalId
	const rows = await db
		.select(paragraphFields)
		.from(paragraphs)
		.where(inArray(paragraphs.id, globalIds));

	const map = new Map<string, ParagraphEntity>();
	for (const row of rows) {
		map.set(row.id, row as unknown as ParagraphEntity);
	}
	return map;
}
