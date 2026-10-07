// Helpers for the world religions layer: corpus lookup by any of its names,
// and `?include=scriptureParallels` on paragraphs. Named after the TARGET
// type, like bible-parallels.ts.
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { scriptureChunks, scriptureCorpora, scriptureParallels } from "../db/schema.ts";

type Db = ReturnType<typeof getDb>["db"];
type ParagraphRow = { id: string; [key: string]: unknown };

export type ScriptureCorpus = typeof scriptureCorpora.$inferSelect;

/** Parallels per corpus on a paragraph. The table keeps 5; the include shows 3. */
export const INCLUDE_PER_CORPUS = 3;

let corporaCache: { at: number; rows: ScriptureCorpus[] } | undefined;

export async function listCorpora(db: Db): Promise<ScriptureCorpus[]> {
	if (corporaCache && Date.now() - corporaCache.at < 300_000) return corporaCache.rows;
	const rows = await db.select().from(scriptureCorpora).orderBy(asc(scriptureCorpora.sortOrder));
	corporaCache = { at: Date.now(), rows };
	return rows;
}

/** Finds a corpus by id, slug, or ref prefix, case-insensitive. */
export async function resolveCorpus(db: Db, name: string): Promise<ScriptureCorpus | undefined> {
	const key = name.trim().toLowerCase();
	return (await listCorpora(db)).find(
		(c) => c.id === key || c.slug === key || c.refPrefix.toLowerCase() === key,
	);
}

export function corpusSummary(c: ScriptureCorpus) {
	return {
		id: c.id,
		slug: c.slug,
		religion: c.religion,
		title: c.title,
		translator: c.translator,
		year: c.year,
		refPrefix: c.refPrefix,
		urantiaSection: c.urantiaSection,
	};
}

export type ScriptureParallel = {
	chunkId: string;
	reference: string;
	corpus: ReturnType<typeof corpusSummary>;
	text: string;
	similarity: number;
	rank: number;
	source: string;
	embeddingModel: string;
};

export function wantsScriptureParallels(include: string | undefined): boolean {
	if (!include) return false;
	return include
		.split(",")
		.map((s) => s.trim())
		.includes("scriptureParallels");
}

/** Adds the top passages of each corpus to each paragraph row. */
export async function enrichWithScriptureParallels<T extends ParagraphRow>(
	db: Db,
	rows: T[],
): Promise<(T & { scriptureParallels: ScriptureParallel[] })[]> {
	if (rows.length === 0) return [];
	const corpora = new Map((await listCorpora(db)).map((c) => [c.id, c]));
	const found = await db
		.select({
			paragraphId: scriptureParallels.paragraphId,
			corpusId: scriptureParallels.corpusId,
			chunkId: scriptureChunks.id,
			label: scriptureChunks.label,
			text: scriptureChunks.text,
			similarity: scriptureParallels.similarity,
			rank: scriptureParallels.rank,
			source: scriptureParallels.source,
			embeddingModel: scriptureParallels.embeddingModel,
		})
		.from(scriptureParallels)
		.innerJoin(scriptureChunks, eq(scriptureParallels.chunkId, scriptureChunks.id))
		.where(
			and(
				inArray(
					scriptureParallels.paragraphId,
					rows.map((r) => r.id),
				),
				eq(scriptureParallels.direction, "ub_to_scripture"),
				lte(scriptureParallels.rank, INCLUDE_PER_CORPUS),
			),
		)
		.orderBy(asc(scriptureParallels.paragraphId), asc(scriptureParallels.rank));

	const order = (id: string) => corpora.get(id)?.sortOrder ?? 99;
	const byParagraph = new Map<string, ScriptureParallel[]>();
	for (const r of found) {
		const corpus = corpora.get(r.corpusId);
		if (!corpus) continue;
		const list = byParagraph.get(r.paragraphId) ?? [];
		list.push({
			chunkId: r.chunkId,
			reference: r.label,
			corpus: corpusSummary(corpus),
			text: r.text,
			similarity: r.similarity,
			rank: r.rank,
			source: r.source,
			embeddingModel: r.embeddingModel,
		});
		byParagraph.set(r.paragraphId, list);
	}
	for (const list of byParagraph.values()) {
		list.sort((a, b) => order(a.corpus.id) - order(b.corpus.id) || a.rank - b.rank);
	}
	return rows.map((r) => ({ ...r, scriptureParallels: byParagraph.get(r.id) ?? [] }));
}
