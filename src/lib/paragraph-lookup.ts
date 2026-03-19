import { eq } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { detectRefFormat } from "../types/node.ts";

/**
 * Resolve a paragraph reference (any format) to its core IDs.
 * Returns null if not found or invalid format.
 */
export async function resolveParagraphRef(
	db: ReturnType<typeof getDb>["db"],
	ref: string,
): Promise<{
	paragraphId: string; // globalId
	paperId: string;
	paperSectionId: string;
	paperSectionParagraphId: string;
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
		.select({
			globalId: paragraphs.globalId,
			paperId: paragraphs.paperId,
			paperSectionParagraphId: paragraphs.paperSectionParagraphId,
			standardReferenceId: paragraphs.standardReferenceId,
		})
		.from(paragraphs)
		.where(eq(column, ref))
		.limit(1);

	if (!row) return null;

	// Derive paperSectionId from standardReferenceId (e.g. "2:0.1" → "2:0")
	const paperSectionId = row.standardReferenceId.replace(/\.\d+$/, "");

	return {
		paragraphId: row.globalId,
		paperId: row.paperId,
		paperSectionId,
		paperSectionParagraphId: row.paperSectionParagraphId,
	};
}
