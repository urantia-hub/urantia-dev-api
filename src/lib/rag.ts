import type { getDb } from "../db/client.ts";
import { getParagraphNavigation } from "./paragraph-lookup.ts";

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
	bibleParallels?: Array<{
		reference: string;
		text: string;
		similarity: number;
		rank: number;
	}>;
	paragraphParallels?: Array<{
		standardReferenceId: string;
		paperTitle: string;
		text: string;
		similarity: number;
		rank: number;
	}>;
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
	bibleParallels?: Array<{
		reference: string;
		text: string;
		similarity: number;
		rank: number;
	}>;
	paragraphParallels?: Array<{
		ref: string;
		paperTitle: string;
		text: string;
		similarity: number;
		rank: number;
	}>;
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

	const navigation = await getParagraphNavigation(db, paragraph.paperId, paragraph.sortId);

	const entityNames = paragraph.entities?.map((e) => e.name) ?? [];

	const result: RagResponse = {
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
		navigation,
		tokenCount,
		entities: entityNames,
	};

	if (paragraph.bibleParallels?.length) {
		result.bibleParallels = paragraph.bibleParallels.map((p) => ({
			reference: p.reference,
			text: p.text,
			similarity: p.similarity,
			rank: p.rank,
		}));
	}

	if (paragraph.paragraphParallels?.length) {
		result.paragraphParallels = paragraph.paragraphParallels.map((p) => ({
			ref: p.standardReferenceId,
			paperTitle: p.paperTitle,
			text: p.text,
			similarity: p.similarity,
			rank: p.rank,
		}));
	}

	return result;
}
