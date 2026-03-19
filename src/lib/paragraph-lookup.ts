import { eq, inArray } from "drizzle-orm";
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
 */
export async function resolveParagraphRef(
	db: ReturnType<typeof getDb>["db"],
	ref: string,
): Promise<{
	// IDs for storage in user data tables
	globalId: string;
	paperId: string;
	paperSectionId: string;
	paperSectionParagraphId: string;
	// Full paragraph entity for response enrichment
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

	const paperSectionId = row.standardReferenceId.replace(/\.\d+$/, "");

	return {
		globalId: row.id, // paragraphs.id IS the globalId
		paperId: row.paperId,
		paperSectionId,
		paperSectionParagraphId: `${row.paperId}.${row.sectionId ?? "0"}.${row.paragraphId}`,
		paragraph: row as ParagraphEntity,
	};
}

/**
 * Look up full paragraph entities for a batch of globalIds.
 */
export async function lookupParagraphs(
	db: ReturnType<typeof getDb>["db"],
	globalIds: string[],
): Promise<Map<string, ParagraphEntity>> {
	if (globalIds.length === 0) return new Map();

	const rows = await db
		.select(paragraphFields)
		.from(paragraphs)
		.where(inArray(paragraphs.id, globalIds));

	const map = new Map<string, ParagraphEntity>();
	for (const row of rows) {
		map.set(row.id, row as ParagraphEntity);
	}
	return map;
}
