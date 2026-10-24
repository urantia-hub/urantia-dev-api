// Keyword search of the Spanish Papers, for /search and `search.fulltext` with lang=es.
// Tiers: a reference, the exact phrase, all words (the last one a prefix). Words match with or
// without their accents, on the trigram index `pt_es_match_text_trgm_idx` (scripts/setup-search-es.sql).
import { and, eq, type SQL, sql } from "drizzle-orm";
import { paragraphs, paragraphTranslations } from "../db/schema.ts";
import type { Match, PaperSearchOptions, PaperSearchResult } from "./paper-search.ts";
import { referenceWhere } from "./paper-search.ts";
import {
	highlightEs,
	normalizedSqlEs,
	normalizeQueryEs,
	parsePaperRefEs,
} from "./search-text-es.ts";
import type { Db } from "./search-words.ts";
import { applyTitleTranslations, type TranslationLabel } from "./translations.ts";

const pt = paragraphTranslations;
const MATCH_TEXT = sql.raw(normalizedSqlEs('"paragraph_translations"."text"'));
const TIERS: Match[] = ["reference", "exact", "all", "near", "near", "most"];
// A literal, not a parameter, so the planner can use the partial index of the Spanish rows.
const join = and(eq(pt.paragraphId, paragraphs.id), sql`${pt.language} = 'es'`) as SQL;

const columns = {
	id: paragraphs.id,
	standardReferenceId: paragraphs.standardReferenceId,
	sortId: paragraphs.sortId,
	paperId: paragraphs.paperId,
	sectionId: sql<
		string | null
	>`CASE WHEN ${paragraphs.sectionId} IS NOT NULL THEN split_part(${paragraphs.sectionId}, '.', 2) ELSE NULL END`,
	partId: paragraphs.partId,
	paperTitle: paragraphs.paperTitle,
	sectionTitle: paragraphs.sectionTitle,
	paragraphId: paragraphs.paragraphId,
	text: sql<string>`coalesce(${pt.text}, ${paragraphs.text})`,
	htmlText: sql<string>`coalesce(${pt.htmlText}, ${paragraphs.htmlText})`,
	labels: paragraphs.labels,
	audio: paragraphs.audio,
	confidence: pt.confidence,
	translated: sql<boolean>`${pt.id} is not null`,
};

export async function searchPapersEs(db: Db, opts: PaperSearchOptions): Promise<PaperSearchResult> {
	const { q, type, page, limit } = opts;
	const filters: SQL[] = [];
	if (opts.paperId) filters.push(eq(paragraphs.paperId, opts.paperId));
	if (opts.partId) filters.push(eq(paragraphs.partId, opts.partId));
	const empty = (): PaperSearchResult => ({
		data: [],
		meta: { page, limit, total: 0, totalPages: 0 },
	});

	const run = async (where: SQL, tier: SQL, words: string[], prefixLast: boolean) => {
		const scoped = and(where, ...filters) as SQL;
		const [[counted], rows] = await Promise.all([
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(paragraphs)
				.leftJoin(pt, join)
				.where(scoped),
			db
				.select({ ...columns, tier: sql<number>`${tier}` })
				.from(paragraphs)
				.leftJoin(pt, join)
				.where(scoped)
				.orderBy(...(words.length ? [sql`${tier}`] : []), paragraphs.sortId)
				.limit(limit)
				.offset(page * limit),
		]);
		const titled = await applyTitleTranslations(db, rows, "es");
		const total = Number(counted?.n ?? 0);
		return {
			data: titled.map(({ tier: t, confidence, translated, ...row }) => ({
				...row,
				htmlText: words.length ? highlightEs(row.htmlText, words, prefixLast) : row.htmlText,
				rank: 0,
				match: TIERS[Number(t)] as Match,
				language: translated ? "es" : "eng",
				...(translated
					? {
							translation: {
								method: "machine",
								license: "CC0-1.0",
								review: confidence,
							} as TranslationLabel,
						}
					: {}),
			})),
			meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
		};
	};

	if (type === "auto") {
		const ref = parsePaperRefEs(q);
		if (ref) return run(referenceWhere(ref), sql`0`, [], false);
	}

	const nq = normalizeQueryEs(q);
	if (nq.words.length === 0) return empty();
	const like = (pattern: string) => sql`${MATCH_TEXT} like ${pattern}`;
	const exact = like(`% ${nq.text} %`);
	const prefixLast = type === "auto" && !nq.quoted;
	const wordLikes = nq.words.map((w, i) =>
		like(i === nq.words.length - 1 && prefixLast ? `% ${w}%` : `% ${w} %`),
	);
	const all = sql`(${sql.join(wordLikes, sql` and `)})`;
	const some = sql`(${sql.join(wordLikes, sql` or `)})`;
	const translated = sql`${pt.id} is not null`;

	const tier = sql`case when ${exact} then 1 when ${all} then 2 else 5 end`;
	const where =
		type === "phrase" || (type === "auto" && nq.quoted)
			? exact
			: type === "or"
				? some
				: sql`(${exact} or ${all})`;
	return run(and(translated, where) as SQL, tier, nq.words, prefixLast);
}
