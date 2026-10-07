// Helpers for the scripture insights: the Bible as a "text" beside the corpora,
// passage lookups across both kinds of chunk, and `?include=scriptureScores`.
import { inArray } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import {
	bibleChunks,
	paragraphScriptureScores,
	scriptureChunks,
	scriptureMutualPairs,
} from "../db/schema.ts";
import { formatBibleReference } from "./bible-canonicalizer.ts";
import { corpusSummary, listCorpora } from "./scripture-parallels.ts";

type Db = ReturnType<typeof getDb>["db"];
type Summary = ReturnType<typeof corpusSummary>;

export const BIBLE_SUMMARY: Summary = {
	id: "bible",
	slug: "bible",
	religion: "Judaism and Christianity",
	title: "World English Bible",
	translator: "World English Bible",
	year: 2000,
	refPrefix: "",
	urantiaSection: "131:2",
};

/** Summaries for every text the scores cover, by id. */
export async function textSummaries(db: Db): Promise<Map<string, Summary>> {
	const corpora = await listCorpora(db);
	return new Map<string, Summary>([
		...corpora.map((c) => [c.id, corpusSummary(c)] as const),
		["bible", BIBLE_SUMMARY],
	]);
}

/** Resolves a corpus name for the insights filters. "bible" is allowed. */
export async function resolveInsightCorpus(db: Db, name: string): Promise<string | undefined> {
	const key = name.trim().toLowerCase();
	if (key === "bible") return "bible";
	const corpora = await listCorpora(db);
	return corpora.find((c) => c.id === key || c.slug === key || c.refPrefix.toLowerCase() === key)
		?.id;
}

/** Loads reference and text for scripture and Bible chunk ids in two queries. */
export async function loadPassages(
	db: Db,
	items: { corpusId: string; chunkId: string }[],
): Promise<Map<string, { chunkId: string; reference: string; text: string }>> {
	const out = new Map<string, { chunkId: string; reference: string; text: string }>();
	const sc = items.filter((i) => i.corpusId !== "bible").map((i) => i.chunkId);
	const bc = items.filter((i) => i.corpusId === "bible").map((i) => i.chunkId);
	if (sc.length) {
		const rows = await db
			.select({ id: scriptureChunks.id, label: scriptureChunks.label, text: scriptureChunks.text })
			.from(scriptureChunks)
			.where(inArray(scriptureChunks.id, sc));
		for (const r of rows) out.set(r.id, { chunkId: r.id, reference: r.label, text: r.text });
	}
	if (bc.length) {
		const rows = await db.select().from(bibleChunks).where(inArray(bibleChunks.id, bc));
		for (const r of rows) {
			const start = formatBibleReference(r.bookCode, r.chapter, r.verseStart) ?? r.id;
			out.set(r.id, {
				chunkId: r.id,
				reference: r.verseEnd === r.verseStart ? start : `${start}-${r.verseEnd}`,
				text: r.text,
			});
		}
	}
	return out;
}

/** A profile as a list, best text first. */
export function profileList(profile: Record<string, number>, texts: Map<string, Summary>) {
	return Object.entries(profile)
		.flatMap(([id, percentile]) => {
			const corpus = texts.get(id);
			return corpus ? [{ corpus, percentile }] : [];
		})
		.sort((a, b) => b.percentile - a.percentile);
}

export function wantsScriptureScores(include: string | undefined): boolean {
	return (include ?? "")
		.split(",")
		.map((s) => s.trim())
		.includes("scriptureScores");
}

type ParagraphRow = { id: string; [key: string]: unknown };

/** Adds the scores, the lean, and the mutual pairs to each paragraph row. */
export async function enrichWithScriptureScores<T extends ParagraphRow>(db: Db, rows: T[]) {
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const texts = await textSummaries(db);
	const [scores, pairs] = await Promise.all([
		db
			.select()
			.from(paragraphScriptureScores)
			.where(inArray(paragraphScriptureScores.paragraphId, ids)),
		db.select().from(scriptureMutualPairs).where(inArray(scriptureMutualPairs.paragraphId, ids)),
	]);
	const passages = await loadPassages(db, pairs);
	const byId = new Map(scores.map((s) => [s.paragraphId, s]));
	return rows.map((r) => {
		const s = byId.get(r.id);
		if (!s) return { ...r, scriptureScores: null };
		const lean = s.leanCorpus ? texts.get(s.leanCorpus) : undefined;
		return {
			...r,
			scriptureScores: {
				textsClose: s.textsClose,
				consensus: s.consensus,
				distance: s.distance,
				lean: lean && s.leanGap !== null ? { corpus: lean, gap: s.leanGap } : null,
				mutualPairs: pairs
					.filter((p) => p.paragraphId === r.id)
					.flatMap((p) => {
						const corpus = texts.get(p.corpusId);
						const passage = passages.get(p.chunkId);
						return corpus && passage ? [{ corpus, passage }] : [];
					}),
				profile: profileList(s.profile as Record<string, number>, texts),
			},
		};
	});
}
