// Helpers for the UB↔UB cross-reference feature ("see also" between
// Urantia paragraphs). Naming mirrors `bible-parallels.ts`: both libraries
// are named after the TARGET type they surface — Urantia paragraphs vs
// Bible verses.

import { aliasedTable, asc, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { paragraphs, urantiaParallels } from "../db/schema.ts";

type Db = ReturnType<typeof getDb>["db"];
type ParagraphRow = { id: string; [key: string]: unknown };

export type UrantiaParallel = {
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

export function wantsUrantiaParallels(include: string | undefined): boolean {
	if (!include) return false;
	return include
		.split(",")
		.map((s) => s.trim())
		.includes("urantiaParallels");
}

export async function enrichWithUrantiaParallels<T extends ParagraphRow>(
	db: Db,
	rows: T[],
): Promise<(T & { urantiaParallels: UrantiaParallel[] })[]> {
	if (rows.length === 0) return [];

	const sourceIds = rows.map((r) => r.id);
	const target = aliasedTable(paragraphs, "target_p");

	const junctionRows = await db
		.select({
			sourceId: urantiaParallels.sourceParagraphId,
			targetId: target.id,
			standardReferenceId: target.standardReferenceId,
			paperId: target.paperId,
			paperTitle: target.paperTitle,
			sectionTitle: target.sectionTitle,
			text: target.text,
			similarity: urantiaParallels.similarity,
			rank: urantiaParallels.rank,
			embeddingModel: urantiaParallels.embeddingModel,
		})
		.from(urantiaParallels)
		.innerJoin(target, eq(urantiaParallels.targetParagraphId, target.id))
		.where(inArray(urantiaParallels.sourceParagraphId, sourceIds))
		.orderBy(asc(urantiaParallels.sourceParagraphId), asc(urantiaParallels.rank));

	const bySource = new Map<string, UrantiaParallel[]>();
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
		urantiaParallels: bySource.get(r.id) ?? [],
	}));
}
