// Helpers for the UB↔UB cross-reference feature ("see also" between
// paragraphs). Mirrors src/lib/bible-parallels.ts but the target is
// another UB paragraph rather than a Bible chunk.

import { aliasedTable, asc, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { paragraphParallels, paragraphs } from "../db/schema.ts";

type Db = ReturnType<typeof getDb>["db"];
type ParagraphRow = { id: string; [key: string]: unknown };

export type ParagraphParallel = {
	id: string;
	standardReferenceId: string;
	paperId: string;
	paperTitle: string;
	sectionTitle: string | null;
	text: string;
	similarity: number;
	rank: number;
	embeddingModel: string;
};

export function wantsParagraphParallels(include: string | undefined): boolean {
	if (!include) return false;
	return include
		.split(",")
		.map((s) => s.trim())
		.includes("paragraphParallels");
}

export async function enrichWithParagraphParallels<T extends ParagraphRow>(
	db: Db,
	rows: T[],
): Promise<(T & { paragraphParallels: ParagraphParallel[] })[]> {
	if (rows.length === 0) return [];

	const sourceIds = rows.map((r) => r.id);
	const target = aliasedTable(paragraphs, "target_p");

	const junctionRows = await db
		.select({
			sourceId: paragraphParallels.sourceParagraphId,
			targetId: target.id,
			standardReferenceId: target.standardReferenceId,
			paperId: target.paperId,
			paperTitle: target.paperTitle,
			sectionTitle: target.sectionTitle,
			text: target.text,
			similarity: paragraphParallels.similarity,
			rank: paragraphParallels.rank,
			embeddingModel: paragraphParallels.embeddingModel,
		})
		.from(paragraphParallels)
		.innerJoin(target, eq(paragraphParallels.targetParagraphId, target.id))
		.where(inArray(paragraphParallels.sourceParagraphId, sourceIds))
		.orderBy(asc(paragraphParallels.sourceParagraphId), asc(paragraphParallels.rank));

	const bySource = new Map<string, ParagraphParallel[]>();
	for (const r of junctionRows) {
		const list = bySource.get(r.sourceId) ?? [];
		list.push({
			id: r.targetId,
			standardReferenceId: r.standardReferenceId,
			paperId: r.paperId,
			paperTitle: r.paperTitle,
			sectionTitle: r.sectionTitle,
			text: r.text,
			similarity: r.similarity,
			rank: r.rank,
			embeddingModel: r.embeddingModel,
		});
		bySource.set(r.sourceId, list);
	}

	return rows.map((r) => ({
		...r,
		paragraphParallels: bySource.get(r.id) ?? [],
	}));
}
