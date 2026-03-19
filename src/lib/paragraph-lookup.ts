import { eq, inArray } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { detectRefFormat } from "../types/node.ts";

export type ParagraphSummary = {
	paragraphId: string; // globalId
	standardReferenceId: string;
	paperId: string;
	paperSectionId: string;
	paperSectionParagraphId: string;
	paperTitle: string;
	sectionTitle: string | null;
	text: string;
};

/**
 * Resolve a paragraph reference (any format) to its core IDs + content.
 * Returns null if not found or invalid format.
 */
export async function resolveParagraphRef(
	db: ReturnType<typeof getDb>["db"],
	ref: string,
): Promise<ParagraphSummary | null> {
	const format = detectRefFormat(ref);
	if (format === "unknown") return null;

	const column =
		format === "globalId"
			? paragraphs.globalId
			: format === "standardReferenceId"
				? paragraphs.standardReferenceId
				: paragraphs.paperSectionParagraphId;

	const [row] = await db
		.select({
			globalId: paragraphs.globalId,
			standardReferenceId: paragraphs.standardReferenceId,
			paperId: paragraphs.paperId,
			paperSectionParagraphId: paragraphs.paperSectionParagraphId,
			paperTitle: paragraphs.paperTitle,
			sectionTitle: paragraphs.sectionTitle,
			text: paragraphs.text,
		})
		.from(paragraphs)
		.where(eq(column, ref))
		.limit(1);

	if (!row) return null;

	const paperSectionId = row.standardReferenceId.replace(/\.\d+$/, "");

	return {
		paragraphId: row.globalId,
		standardReferenceId: row.standardReferenceId,
		paperId: row.paperId,
		paperSectionId,
		paperSectionParagraphId: row.paperSectionParagraphId,
		paperTitle: row.paperTitle,
		sectionTitle: row.sectionTitle,
		text: row.text,
	};
}

/**
 * Look up paragraph summaries for a batch of globalIds.
 * Returns a Map of globalId → ParagraphSummary.
 */
export async function lookupParagraphs(
	db: ReturnType<typeof getDb>["db"],
	globalIds: string[],
): Promise<Map<string, ParagraphSummary>> {
	if (globalIds.length === 0) return new Map();

	const rows = await db
		.select({
			globalId: paragraphs.globalId,
			standardReferenceId: paragraphs.standardReferenceId,
			paperId: paragraphs.paperId,
			paperSectionParagraphId: paragraphs.paperSectionParagraphId,
			paperTitle: paragraphs.paperTitle,
			sectionTitle: paragraphs.sectionTitle,
			text: paragraphs.text,
		})
		.from(paragraphs)
		.where(inArray(paragraphs.globalId, globalIds));

	const map = new Map<string, ParagraphSummary>();
	for (const row of rows) {
		const paperSectionId = row.standardReferenceId.replace(/\.\d+$/, "");
		map.set(row.globalId, {
			paragraphId: row.globalId,
			standardReferenceId: row.standardReferenceId,
			paperId: row.paperId,
			paperSectionId,
			paperSectionParagraphId: row.paperSectionParagraphId,
			paperTitle: row.paperTitle,
			sectionTitle: row.sectionTitle,
			text: row.text,
		});
	}
	return map;
}
