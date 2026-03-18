import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";

interface ParagraphRow {
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
	entities?: Array<{ id: string; name: string; type: string }>;
}

export interface RagResponse {
	ref: string;
	text: string;
	citation: string;
	metadata: {
		paperId: string;
		paperTitle: string;
		sectionId: string | null;
		sectionTitle: string | null;
		partId: string;
		paragraphId: string;
	};
	navigation: {
		prev: string | null;
		next: string | null;
	};
	tokenCount: number;
	entities: string[];
}

/**
 * Transform a paragraph row into the RAG-optimized format.
 */
export async function toRagFormat(
	db: ReturnType<typeof getDb>["db"],
	paragraph: ParagraphRow,
): Promise<RagResponse> {
	const { paperId, sectionId, paragraphId: paraId, paperTitle, sectionTitle, partId } = paragraph;

	const citation = `The Urantia Book, Paper ${paperId}, Section ${sectionId ?? "0"}, Paragraph ${paraId}`;
	const tokenCount = paragraph.text.split(/\s+/).filter(Boolean).length;

	// Get prev/next by sortId within the same paper
	const [prevRows, nextRows] = await Promise.all([
		db
			.select({ standardReferenceId: paragraphs.standardReferenceId })
			.from(paragraphs)
			.where(
				and(
					eq(paragraphs.paperId, paragraph.paperId),
					lt(paragraphs.sortId, paragraph.sortId),
				),
			)
			.orderBy(sql`${paragraphs.sortId} DESC`)
			.limit(1),
		db
			.select({ standardReferenceId: paragraphs.standardReferenceId })
			.from(paragraphs)
			.where(
				and(
					eq(paragraphs.paperId, paragraph.paperId),
					gt(paragraphs.sortId, paragraph.sortId),
				),
			)
			.orderBy(paragraphs.sortId)
			.limit(1),
	]);

	const entityNames = paragraph.entities?.map((e) => e.name) ?? [];

	return {
		ref: paragraph.standardReferenceId,
		text: paragraph.text,
		citation,
		metadata: {
			paperId,
			paperTitle,
			sectionId: sectionId ?? null,
			sectionTitle: sectionTitle ?? null,
			partId,
			paragraphId: paraId,
		},
		navigation: {
			prev: prevRows[0]?.standardReferenceId ?? null,
			next: nextRows[0]?.standardReferenceId ?? null,
		},
		tokenCount,
		entities: entityNames,
	};
}
