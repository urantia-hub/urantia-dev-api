// Keyword search of the Papers, shared by GET/POST /search and the MCP tool `search.fulltext`.
// `auto` tiers: a reference, the exact phrase, all words, near words (a typo fixed), most words.
import { and, eq, type SQL, sql } from "drizzle-orm";
import { paragraphs } from "../db/schema.ts";
import {
	normalizeQuery,
	type PaperRef,
	parsePaperRef,
	toTsQuery,
	type WorkHint,
	workHint,
} from "./search-text.ts";
import { correctWords, type Db, matchText, textArray } from "./search-words.ts";

export type SearchType = "auto" | "and" | "or" | "phrase";

const MATCH_TEXT = matchText('"paragraphs"."text"');
export type Match = "reference" | "exact" | "all" | "near" | "most";
export type PaperSearchOptions = {
	q: string;
	type: SearchType;
	page: number;
	limit: number;
	paperId?: string;
	partId?: string;
};

// `most` and `near` run only when the exact and all-word tiers give fewer results than this.
const ENOUGH = 10;
// Tier numbers: 1 exact, 2 all, 3 near phrase, 4 near words, 5 most. 0 is a reference.
const TIERS: Match[] = ["reference", "exact", "all", "near", "near", "most"];
const HIGHLIGHT =
	'StartSel="<span class=urantia-dev-highlighted>", StopSel="</span>", MaxFragments=0, HighlightAll=true';

const tsq = (query: string) => sql`to_tsquery('english', ${query})`;

export const columns = (highlight: SQL | null) => ({
	id: paragraphs.id,
	standardReferenceId: paragraphs.standardReferenceId,
	sortId: paragraphs.sortId,
	paperId: paragraphs.paperId,
	sectionId: sql<
		string | null
	>`CASE WHEN ${paragraphs.sectionId} IS NOT NULL THEN split_part(${paragraphs.sectionId}, '.', 2) ELSE NULL END`.as(
		"sectionId",
	),
	partId: paragraphs.partId,
	paperTitle: paragraphs.paperTitle,
	sectionTitle: paragraphs.sectionTitle,
	paragraphId: paragraphs.paragraphId,
	text: paragraphs.text,
	htmlText: highlight
		? sql<string>`ts_headline('english', ${paragraphs.htmlText}, ${highlight}, ${HIGHLIGHT})`
		: paragraphs.htmlText,
	labels: paragraphs.labels,
	audio: paragraphs.audio,
});

export type PaperSearchResult = {
	data: (Omit<Awaited<ReturnType<typeof selectPage>>[number], "tier"> & { match: Match })[];
	meta: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
		didYouMean?: string;
		see?: WorkHint;
	};
};

function selectPage(
	db: Db,
	where: SQL,
	tier: SQL,
	order: SQL[],
	highlight: SQL | null,
	page: number,
	limit: number,
) {
	return db
		.select({
			...columns(highlight),
			// The rank of the words (as before 2026-10-18); a reference has none.
			rank: highlight
				? sql<number>`ts_rank(${paragraphs.searchVector}, ${highlight})`
				: sql<number>`0::real`,
			tier: sql<number>`${tier}`,
		})
		.from(paragraphs)
		.where(where)
		.orderBy(...order)
		.limit(limit)
		.offset(page * limit);
}

async function count(db: Db, where: SQL): Promise<number> {
	const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(paragraphs).where(where);
	return Number(row?.n ?? 0);
}

/** The words that a search vector can hold: not a stopword of the English configuration. */
export async function contentWords(db: Db, words: string[]): Promise<Set<string>> {
	if (words.length === 0) return new Set();
	const rows = (await db.execute(
		sql`select w from unnest(${textArray(words)}) as w where length(to_tsvector('english', w)) > 0`,
	)) as unknown as { w: string }[];
	return new Set(rows.map((r) => r.w));
}

/** The paragraphs that a reference names: one paragraph, a section, or a paper. */
export const referenceWhere = (ref: PaperRef): SQL =>
	ref.paragraphId
		? eq(paragraphs.standardReferenceId, `${ref.paperId}:${ref.sectionId}.${ref.paragraphId}`)
		: ref.sectionId
			? sql`${paragraphs.standardReferenceId} like ${`${ref.paperId}:${ref.sectionId}.%`}`
			: eq(paragraphs.paperId, ref.paperId);

export async function searchPapers(db: Db, opts: PaperSearchOptions): Promise<PaperSearchResult> {
	const { q, type, page, limit } = opts;
	const filters: SQL[] = [];
	if (opts.paperId) filters.push(eq(paragraphs.paperId, opts.paperId));
	if (opts.partId) filters.push(eq(paragraphs.partId, opts.partId));
	const see = type === "auto" ? (workHint(q) ?? undefined) : undefined;
	const result = async (
		where: SQL,
		tier: SQL,
		order: SQL[],
		highlight: SQL | null,
		didYouMean?: string,
	) => {
		const scoped = and(where, ...filters) as SQL;
		const [total, rows] = await Promise.all([
			count(db, scoped),
			selectPage(db, scoped, tier, order, highlight, page, limit),
		]);
		return {
			data: rows.map(({ tier: t, ...row }) => ({ ...row, match: TIERS[Number(t)] as Match })),
			meta: { page, limit, total, totalPages: Math.ceil(total / limit), didYouMean, see },
		};
	};
	const empty = (): PaperSearchResult => ({
		data: [],
		meta: { page, limit, total: 0, totalPages: 0, see },
	});

	if (type === "auto") {
		const ref = parsePaperRef(q);
		if (ref) {
			return result(referenceWhere(ref), sql`0`, [sql`${paragraphs.sortId}`], null);
		}
	}

	const nq = normalizeQuery(q);
	if (nq.words.length === 0) return empty();
	const content = await contentWords(db, nq.words);
	const keep = (words: string[]) => words.filter((w) => content.has(w));
	const exact = sql`${MATCH_TEXT} like ${`% ${nq.text} %`}`;
	const rankBy = (query: SQL) => sql`ts_rank(${paragraphs.searchVector}, ${query}) desc`;

	if (type !== "auto") {
		const words = keep(nq.words);
		if (words.length === 0) return empty();
		const query =
			type === "phrase"
				? sql`phraseto_tsquery('english', ${nq.text})`
				: tsq(toTsQuery(words, type === "and" ? "&" : "|", false));
		// In `or` mode a paragraph with only some of the words is `most`, not `all`.
		const every =
			type === "or"
				? sql`${paragraphs.searchVector} @@ ${tsq(toTsQuery(words, "&", false))}`
				: sql`true`;
		const tier = sql`case when ${exact} then 1 when ${every} then 2 else 5 end`;
		return result(
			sql`${paragraphs.searchVector} @@ ${query}`,
			tier,
			[tier, rankBy(query), sql`${paragraphs.sortId}`],
			query,
		);
	}

	// auto: the last word of the query is a prefix, unless the query is in quotes or that word is a
	// stopword (then no word is a prefix).
	const prefix = !nq.quoted;
	const lastIsPrefix = prefix && content.has(nq.words.at(-1) as string);
	const words = keep(nq.words);
	const allQuery = words.length > 0 && !nq.quoted ? tsq(toTsQuery(words, "&", lastIsPrefix)) : null;
	const all = allQuery ? sql`${paragraphs.searchVector} @@ ${allQuery}` : sql`false`;
	const base = sql`(${exact} or ${all})`;

	let nearPhrase: SQL = sql`false`;
	let near: SQL = sql`false`;
	let most: SQL = sql`false`;
	let mostCount: SQL | null = null;
	let didYouMean: string | undefined;
	let highlightWords = words;
	let mostWords = words;
	let mostPrefix = lastIsPrefix;
	if ((await count(db, and(base, ...filters) as SQL)) < ENOUGH) {
		const fixed = await correctWords(db, "papers", nq.words, prefix);
		if (fixed) {
			didYouMean = fixed.join(" ");
			const fixedContent = await contentWords(db, fixed);
			const fixedWords = fixed.filter((w) => fixedContent.has(w));
			// A fixed last word is a whole word; an unchanged one keeps its prefix.
			const fixedPrefix = lastIsPrefix && fixed.at(-1) === nq.words.at(-1);
			nearPhrase = sql`${MATCH_TEXT} like ${`% ${didYouMean} %`}`;
			if (fixedWords.length > 0 && !nq.quoted) {
				near = sql`${paragraphs.searchVector} @@ ${tsq(toTsQuery(fixedWords, "&", fixedPrefix))}`;
			}
			// The query's last word stays last, so a prefix mark goes on it and not on a fixed word.
			const last = words.at(-1);
			highlightWords = [...new Set([...words, ...fixedWords])].filter((w) => w !== last);
			if (last) highlightWords.push(last);
			mostWords = fixedWords;
			mostPrefix = fixedPrefix && fixedContent.has(fixed.at(-1) as string);
		}
		// Most words: 3 or more words that a search vector can hold, and at least two thirds of them.
		if (!nq.quoted && mostWords.length >= 3) {
			const parts = mostWords.map((w, i) =>
				tsq(i === mostWords.length - 1 && mostPrefix ? `${w}:*` : w),
			);
			mostCount = sql`(select count(*) from unnest(array[${sql.join(parts, sql`, `)}]) as t where ${paragraphs.searchVector} @@ t)`;
			most = sql`(${paragraphs.searchVector} @@ ${tsq(toTsQuery(mostWords, "|", mostPrefix))} and ${mostCount} >= ${Math.ceil((mostWords.length * 2) / 3)})`;
		}
	}

	const highlight =
		highlightWords.length > 0 ? tsq(toTsQuery(highlightWords, "|", lastIsPrefix)) : null;
	const tier = sql`case when ${exact} then 1 when ${all} then 2 when ${nearPhrase} then 3 when ${near} then 4 else 5 end`;
	const order = mostCount ? [tier, sql`${mostCount} desc`] : [tier];
	if (highlight) order.push(sql`ts_rank_cd(${paragraphs.searchVector}, ${highlight}) desc`);
	order.push(sql`${paragraphs.sortId}`);
	return result(
		sql`(${base} or ${nearPhrase} or ${near} or ${most})`,
		tier,
		order,
		highlight,
		didYouMean,
	);
}

/** The number of results of each kind on one page, for the request log. */
export const tierCounts = (rows: { match: Match }[]) =>
	rows.reduce<Partial<Record<Match, number>>>((n, r) => {
		n[r.match] = (n[r.match] ?? 0) + 1;
		return n;
	}, {});
