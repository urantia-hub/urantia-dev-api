// The other works beside the Papers, under one set of endpoints (/works) and MCP tools (works.*):
// the Bible (work id "bible") and the texts of scripture_corpora (work id = the corpus slug).
// One result shape for all of them: work, reference, text, url, and the nearest Urantia paragraphs.
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import {
	bibleChunks,
	bibleParallels,
	bibleVerses,
	paragraphs,
	scriptureChunks,
	scriptureParallels,
	scripturePassages,
	scriptureWorkParallels,
} from "../db/schema.ts";
import { formatBibleReference, resolveBibleBook } from "./bible-canonicalizer.ts";
import { contentWords } from "./paper-search.ts";
import { bibleUrl, scriptureUrl, workPage } from "./parallel-links.ts";
import { listCorpora, type ScriptureCorpus } from "./scripture-parallels.ts";
import { MAX_RANGE, namesDivision, parseScriptureRef } from "./scripture-ref.ts";
import { type Strength, strengthOf } from "./search-strength.ts";
import { normalizeQuery, toTsQuery } from "./search-text.ts";
import { correctWords, type Db, matchText } from "./search-words.ts";

export const BIBLE = "bible";
// The most units of one read: the longest page of a work is Koran surah 2 (286 verses).
const READ_MOST = 400;
const MAX_SEMANTIC = 100;
// `near` runs only when the exact and all-word tiers give fewer results than this.
const ENOUGH = 10;

export type Work = {
	id: string;
	title: string;
	religion: string;
	tradition: string;
	kind: "scripture" | "classic" | "recorded";
	summary: string;
	translator: string;
	year: number | null;
	refPrefix: string | null;
	unitLabel: string;
	units: number;
	urantiaSection: string | null;
};
export type WorkMatch = "reference" | "exact" | "all" | "near";
export type UrantiaParallel = {
	standardReferenceId: string;
	paperTitle: string;
	sectionTitle: string | null;
	text: string;
	similarity: number;
	rank: number;
};
export type WorkResult = {
	work: { id: string; title: string; tradition: string };
	reference: string;
	text: string;
	url: string | null;
	match?: WorkMatch;
	similarity?: number;
	strength?: Strength;
	urantiaParallels: UrantiaParallel[];
};
type Meta = {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
	didYouMean?: string;
	related?: number;
};

// A unit is one Bible verse or one passage of a work, with the chunk that holds its parallels.
type Unit = Omit<WorkResult, "urantiaParallels"> & { chunk: { bible: boolean; id: string } | null };

const BIBLE_TRADITION = "Jewish and Christian";
const BIBLE_WORK = {
	id: BIBLE,
	title: "The Bible (World English Bible)",
	tradition: BIBLE_TRADITION,
};

let bibleVerseCount: number | undefined;

export async function listWorks(db: Db): Promise<Work[]> {
	if (bibleVerseCount === undefined) {
		const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(bibleVerses);
		bibleVerseCount = Number(row?.n ?? 0);
	}
	return [
		{
			...BIBLE_WORK,
			religion: BIBLE_TRADITION,
			kind: "scripture",
			summary: "The Hebrew Bible, the deuterocanon, and the New Testament.",
			translator: "World English Bible",
			year: null,
			refPrefix: null,
			unitLabel: "verse",
			units: bibleVerseCount,
			urantiaSection: null,
		},
		...(await listCorpora(db)).map((c) => ({
			id: c.slug,
			title: c.title,
			religion: c.religion,
			tradition: c.religion,
			kind: c.kind as Work["kind"],
			summary: c.summary ?? "",
			translator: c.translator,
			year: c.year,
			refPrefix: c.refPrefix,
			unitLabel: c.unitLabel,
			units: c.passageCount,
			urantiaSection: c.urantiaSection,
		})),
	];
}

/** A work by its id ("bible", a slug), a corpus id, or a ref prefix. Undefined when none. */
export async function resolveWork(
	db: Db,
	name: string,
): Promise<{ bible: true } | { bible: false; corpus: ScriptureCorpus } | undefined> {
	const key = name.trim().toLowerCase();
	if (key === BIBLE) return { bible: true };
	const corpus = (await listCorpora(db)).find(
		(c) => c.slug === key || c.id === key || c.refPrefix.toLowerCase() === key,
	);
	return corpus ? { bible: false, corpus } : undefined;
}

type BibleRef = { book: string; chapter: number; verseStart?: number; verseEnd?: number };

/** "John 3:16", "Jn 3:16-18", "Matthew 5", "1 Cor 13.4". */
export function parseBibleRef(input: string): BibleRef | null {
	const m = input
		.trim()
		.match(/^((?:[1-4]\s?)?[a-z][a-z .]*?)\s*(\d{1,3})(?:[:.](\d{1,3})(?:-(\d{1,3}))?)?$/i);
	if (!m) return null;
	const book = resolveBibleBook((m[1] as string).trim().replace(/\.$/, ""));
	if (!book) return null;
	const chapter = Number(m[2]);
	if (m[3] === undefined) return { book: book.osis, chapter };
	const verseStart = Number(m[3]);
	const verseEnd = m[4] === undefined ? verseStart : Number(m[4]);
	if (verseEnd < verseStart || verseEnd - verseStart >= MAX_RANGE) return null;
	return { book: book.osis, chapter, verseStart, verseEnd };
}

const bibleUnit = (v: {
	bookCode: string;
	chapter: number;
	verse: number;
	text: string;
	chunkId: string | null;
}): Unit => ({
	work: BIBLE_WORK,
	reference:
		formatBibleReference(v.bookCode, v.chapter, v.verse) ?? `${v.bookCode} ${v.chapter}:${v.verse}`,
	text: v.text,
	url: bibleUrl(v.bookCode, v.chapter, v.verse),
	chunk: v.chunkId ? { bible: true, id: v.chunkId } : null,
});

// The link of a passage: the anchor of its chunk when the passage opens that chunk, else the page only,
// since the first words of a short passage can stand in more than one place of the page.
const passageUnit = (
	corpus: ScriptureCorpus,
	p: { ref: string; text: string; chunkId: string | null; anchor: string | null },
): Unit => ({
	work: { id: corpus.slug, title: corpus.title, tradition: corpus.religion },
	reference: p.ref,
	text: p.text,
	url:
		p.chunkId === `${corpus.id}:${p.ref}`
			? scriptureUrl(corpus.id, p.ref, p.text, p.anchor)
			: workPage(corpus.id, p.ref),
	chunk: p.chunkId ? { bible: false, id: p.chunkId } : null,
});

const passageColumns = {
	ref: scripturePassages.ref,
	text: scripturePassages.text,
	chunkId: scripturePassages.chunkId,
	anchor: scriptureChunks.anchor,
};
const verseColumns = {
	bookCode: bibleVerses.bookCode,
	chapter: bibleVerses.chapter,
	verse: bibleVerses.verse,
	text: bibleVerses.text,
	chunkId: bibleVerses.chunkId,
};

// The passages that a scripture ref names (see refCondition in routes/scriptures.ts).
function passageWhere(
	corpus: ScriptureCorpus,
	ref: NonNullable<ReturnType<typeof parseScriptureRef>>,
) {
	const p = scripturePassages;
	const conditions: SQL[] = [eq(p.corpusId, corpus.id)];
	const parts = ref.full ? ref.path.slice(0, -1) : ref.path;
	const columns = corpus.refLevels === 3 ? [p.division, p.subdivision] : [p.division];
	for (const [i, n] of parts.entries()) conditions.push(eq(columns[i] as typeof p.division, n));
	if (ref.full) {
		const start = ref.path[ref.path.length - 1] as number;
		conditions.push(sql`${p.numberEnd} >= ${start} AND ${p.numberStart} <= ${ref.end}`);
	}
	return and(...conditions) as SQL;
}

/**
 * The units that a reference names, at most 200. With `work`, the ref belongs to that work and its
 * prefix is optional ("2.47" for the Bhagavad Gita). Without it, the ref must name its work: a Bible
 * book, or a prefix such as "Dhp". Null when the input is not a reference.
 */
export async function readWork(db: Db, input: string, work?: string): Promise<Unit[] | null> {
	const target = work ? await resolveWork(db, work) : undefined;
	if (work && !target) return null;
	if (!target || target.bible) {
		const ref = parseBibleRef(input);
		if (ref) {
			const where = [eq(bibleVerses.bookCode, ref.book), eq(bibleVerses.chapter, ref.chapter)];
			if (ref.verseStart !== undefined)
				where.push(sql`${bibleVerses.verse} between ${ref.verseStart} and ${ref.verseEnd}`);
			const rows = await db
				.select(verseColumns)
				.from(bibleVerses)
				.where(and(...where))
				.orderBy(asc(bibleVerses.verse))
				.limit(READ_MOST);
			return rows.map(bibleUnit);
		}
		if (target) return null;
	}
	const corpora = target && !target.bible ? [target.corpus] : await listCorpora(db);
	for (const corpus of corpora) {
		const named =
			input.trim().toLowerCase().startsWith(corpus.refPrefix.toLowerCase()) ||
			namesDivision(input, corpus.divisionNames);
		if (!target && !named) continue;
		const ref = parseScriptureRef(input, corpus.refPrefix, corpus.refLevels, corpus.divisionNames);
		if (!ref) continue;
		const rows = await db
			.select(passageColumns)
			.from(scripturePassages)
			.leftJoin(scriptureChunks, eq(scripturePassages.chunkId, scriptureChunks.id))
			.where(passageWhere(corpus, ref))
			.orderBy(asc(scripturePassages.sort))
			.limit(READ_MOST);
		return rows.map((p) => passageUnit(corpus, p));
	}
	return null;
}

/** The nearest Urantia paragraphs of each chunk, best first, `limit` each (0 to 10). */
async function parallelsOf(
	db: Db,
	chunks: { bible: boolean; id: string }[],
	limit: number,
): Promise<Map<string, UrantiaParallel[]>> {
	const out = new Map<string, UrantiaParallel[]>();
	if (limit <= 0) return out;
	const fields = {
		standardReferenceId: paragraphs.standardReferenceId,
		paperTitle: paragraphs.paperTitle,
		sectionTitle: paragraphs.sectionTitle,
		text: paragraphs.text,
	};
	const bible = [...new Set(chunks.filter((c) => c.bible).map((c) => c.id))];
	const works = [...new Set(chunks.filter((c) => !c.bible).map((c) => c.id))];
	const [b, w] = await Promise.all([
		bible.length
			? db
					.select({
						chunkId: bibleParallels.bibleChunkId,
						...fields,
						similarity: bibleParallels.similarity,
						rank: bibleParallels.rank,
					})
					.from(bibleParallels)
					.innerJoin(paragraphs, eq(bibleParallels.paragraphId, paragraphs.id))
					.where(
						and(
							eq(bibleParallels.direction, "bible_to_ub"),
							inArray(bibleParallels.bibleChunkId, bible),
							sql`${bibleParallels.rank} <= ${limit}`,
						),
					)
					.orderBy(asc(bibleParallels.rank))
			: [],
		works.length
			? db
					.select({
						chunkId: scriptureParallels.chunkId,
						...fields,
						similarity: scriptureParallels.similarity,
						rank: scriptureParallels.rank,
					})
					.from(scriptureParallels)
					.innerJoin(paragraphs, eq(scriptureParallels.paragraphId, paragraphs.id))
					.where(
						and(
							eq(scriptureParallels.direction, "scripture_to_ub"),
							inArray(scriptureParallels.chunkId, works),
							sql`${scriptureParallels.rank} <= ${limit}`,
						),
					)
					.orderBy(asc(scriptureParallels.rank))
			: [],
	]);
	for (const { chunkId, ...p } of [...b, ...w]) out.set(chunkId, [...(out.get(chunkId) ?? []), p]);
	return out;
}

async function withParallels(db: Db, units: Unit[], limit: number): Promise<WorkResult[]> {
	const found = await parallelsOf(
		db,
		units.flatMap((u) => (u.chunk ? [u.chunk] : [])),
		limit,
	);
	return units.map(({ chunk, ...u }) => ({
		...u,
		urantiaParallels: chunk ? (found.get(chunk.id) ?? []) : [],
	}));
}

const pageOf = (page: number, limit: number, total: number, didYouMean?: string): Meta => ({
	page,
	limit,
	total,
	totalPages: Math.ceil(total / limit),
	...(didYouMean ? { didYouMean } : {}),
});

export type WorksSearchOptions = {
	q: string;
	work?: string;
	page: number;
	limit: number;
	urantiaParallelLimit: number;
};

/** Null when `work` names no work. */
export async function searchWorks(
	db: Db,
	opts: WorksSearchOptions,
): Promise<{ data: WorkResult[]; meta: Meta } | null> {
	const { q, work, page, limit, urantiaParallelLimit } = opts;
	const target = work ? await resolveWork(db, work) : undefined;
	if (work && !target) return null;

	const named = await readWork(db, q, work);
	if (named) {
		const slice = named.slice(page * limit, page * limit + limit).map((u) => ({
			...u,
			match: "reference" as const,
		}));
		return {
			data: await withParallels(db, slice, urantiaParallelLimit),
			meta: pageOf(page, limit, named.length),
		};
	}

	const nq = normalizeQuery(q);
	if (nq.words.length === 0) return { data: [], meta: pageOf(page, limit, 0) };
	const useBible = !target || target.bible;
	const corpusId = target && !target.bible ? target.corpus.id : undefined;
	const content = await contentWords(db, nq.words);
	const words = nq.words.filter((w) => content.has(w));
	const prefix = !nq.quoted && content.has(nq.words.at(-1) as string);

	// Each tier as SQL on a table of its own: verses `v`, passages `p`.
	const tiers = (text: string, ws: string[], usePrefix: boolean) => {
		const query = ws.length && !nq.quoted ? toTsQuery(ws, "&", usePrefix) : null;
		return {
			exact: (t: string) => sql`${matchText(`${t}.text`)} like ${`% ${text} %`}`,
			all: (t: string) =>
				query
					? sql`${sql.identifier(t)}.search_vector @@ to_tsquery('english', ${query})`
					: sql`false`,
		};
	};
	const base = tiers(nq.text, words, prefix);
	const sources = target ? [target.bible ? "bible" : "works"] : ["bible", "works"];
	let near: ReturnType<typeof tiers> | null = null;
	let didYouMean: string | undefined;
	let rankWords = words;

	const build = (n: ReturnType<typeof tiers> | null) => {
		const tier = (t: string) =>
			n
				? sql`case when ${base.exact(t)} then 1 when ${base.all(t)} then 2 when ${n.exact(t)} then 3 else 4 end`
				: sql`case when ${base.exact(t)} then 1 else 2 end`;
		const cond = (t: string) =>
			n
				? sql`(${base.exact(t)} or ${base.all(t)} or ${n.exact(t)} or ${n.all(t)})`
				: sql`(${base.exact(t)} or ${base.all(t)})`;
		const rank = (t: string) =>
			rankWords.length
				? sql`ts_rank(${sql.identifier(t)}.search_vector, to_tsquery('english', ${toTsQuery(rankWords, "|", prefix)}))`
				: sql`0`;
		const parts: SQL[] = [];
		if (useBible)
			parts.push(sql`select 'bible' as kind, v.id, ${tier("v")} as tier, ${rank("v")} as rank,
				0 as body, v.book_order * 1000000 + v.chapter * 1000 + v.verse as sort
				from bible_verses v where ${cond("v")}`);
		if (!target || !target.bible)
			parts.push(sql`select 'works' as kind, p.id, ${tier("p")} as tier, ${rank("p")} as rank,
				c.sort_order as body, p.sort from scripture_passages p
				join scripture_corpora c on c.id = p.corpus_id
				where ${cond("p")} ${corpusId ? sql`and p.corpus_id = ${corpusId}` : sql``}`);
		return sql.join(parts, sql` union all `);
	};

	const countOf = async (u: SQL) =>
		Number(
			(
				(await db.execute(sql`select count(*)::int as n from (${u}) u`)) as unknown as {
					n: number;
				}[]
			)[0]?.n ?? 0,
		);
	let union = build(null);
	let total = await countOf(union);
	if (total < ENOUGH) {
		const fixed = await correctWords(db, sources, nq.words, !nq.quoted);
		if (fixed) {
			const fixedContent = await contentWords(db, fixed);
			rankWords = [...new Set([...words, ...fixed.filter((w) => fixedContent.has(w))])];
			didYouMean = fixed.join(" ");
			near = tiers(
				didYouMean,
				fixed.filter((w) => fixedContent.has(w)),
				prefix && fixed.at(-1) === nq.words.at(-1),
			);
			union = build(near);
			total = await countOf(union);
		}
	}
	const hits = (await db.execute(sql`
		select kind, id, tier from (${union}) u
		order by tier, rank desc, body, sort limit ${limit} offset ${page * limit}`)) as unknown as {
		kind: "bible" | "works";
		id: string;
		tier: number;
	}[];
	const units = await unitsById(db, hits);
	const data = hits.flatMap((h) => {
		const unit = units.get(h.id);
		if (!unit) return [];
		return [{ ...unit, match: (["exact", "all", "near", "near"] as const)[h.tier - 1] }];
	});
	return {
		data: await withParallels(db, data, urantiaParallelLimit),
		meta: pageOf(page, limit, total, didYouMean),
	};
}

async function unitsById(db: Db, hits: { kind: "bible" | "works"; id: string }[]) {
	const out = new Map<string, Unit>();
	const verseIds = hits.filter((h) => h.kind === "bible").map((h) => h.id);
	const passageIds = hits.filter((h) => h.kind === "works").map((h) => h.id);
	const corpora = new Map((await listCorpora(db)).map((c) => [c.id, c]));
	const [verses, passages] = await Promise.all([
		verseIds.length
			? db
					.select({ id: bibleVerses.id, ...verseColumns })
					.from(bibleVerses)
					.where(inArray(bibleVerses.id, verseIds))
			: [],
		passageIds.length
			? db
					.select({
						id: scripturePassages.id,
						corpusId: scripturePassages.corpusId,
						...passageColumns,
					})
					.from(scripturePassages)
					.leftJoin(scriptureChunks, eq(scripturePassages.chunkId, scriptureChunks.id))
					.where(inArray(scripturePassages.id, passageIds))
			: [],
	]);
	for (const v of verses) out.set(v.id, bibleUnit(v));
	for (const p of passages) {
		const corpus = corpora.get(p.corpusId);
		if (corpus) out.set(p.id, passageUnit(corpus, p));
	}
	return out;
}

export type WorksSemanticOptions = WorksSearchOptions & { embed: () => Promise<number[] | null> };

/**
 * The 100 nearest chunks of the Bible and the works (or of one work), as `meta.total`; `meta.related`
 * counts those that are related or better. A reference gives its units with no vector call. Null when `work` names no
 * work; "embedding" when the query has no vector.
 */
export async function semanticSearchWorks(
	db: Db,
	opts: WorksSemanticOptions,
): Promise<{ data: WorkResult[]; meta: Meta } | null | "embedding"> {
	const { q, work, page, limit, urantiaParallelLimit } = opts;
	const target = work ? await resolveWork(db, work) : undefined;
	if (work && !target) return null;
	const named = await readWork(db, q, work);
	if (named) {
		const found = await searchWorks(db, opts);
		return found && { ...found, meta: { ...found.meta, related: found.meta.total } };
	}

	const vector = await opts.embed();
	if (!vector) return "embedding";
	const v = `[${vector.join(",")}]`;
	const corpusId = target && !target.bible ? target.corpus.id : undefined;
	const near = await db.transaction(async (tx) => {
		await tx.execute(sql`set local hnsw.ef_search = ${sql.raw(String(MAX_SEMANTIC))}`);
		const [b, w] = await Promise.all([
			!target || target.bible
				? (tx.execute(sql`
					select 'bible' as kind, id, 1 - (embedding_small <=> ${v}::vector) as similarity
					from bible_chunks where embedding_small is not null
					order by embedding_small <=> ${v}::vector limit ${MAX_SEMANTIC}`) as unknown as Promise<
						{ kind: "bible"; id: string; similarity: number }[]
					>)
				: [],
			!target || !target.bible
				? (tx.execute(sql`
					select 'works' as kind, id, 1 - (embedding_small <=> ${v}::vector) as similarity
					from scripture_chunks where embedding_small is not null
					${corpusId ? sql`and corpus_id = ${corpusId}` : sql``}
					order by embedding_small <=> ${v}::vector limit ${MAX_SEMANTIC}`) as unknown as Promise<
						{ kind: "works"; id: string; similarity: number }[]
					>)
				: [],
		]);
		return [...b, ...w]
			.map((r) => ({ ...r, similarity: Number(r.similarity) }))
			.sort((x, y) => y.similarity - x.similarity)
			.slice(0, MAX_SEMANTIC);
	});
	const body = (kind: "bible" | "works") => (kind === "bible" ? "bible" : "works");
	const related = near.filter((r) => strengthOf(r.similarity, body(r.kind)) !== "weak").length;
	const slice = near.slice(page * limit, page * limit + limit);
	const chunks = await chunksById(db, slice);
	const units = slice.flatMap((r) => {
		const unit = chunks.get(r.id);
		if (!unit) return [];
		return [
			{ ...unit, similarity: r.similarity, strength: strengthOf(r.similarity, body(r.kind)) },
		];
	});
	return {
		data: await withParallels(db, units, urantiaParallelLimit),
		meta: { ...pageOf(page, limit, near.length), related },
	};
}

async function chunksById(db: Db, hits: { kind: "bible" | "works"; id: string }[]) {
	const out = new Map<string, Unit>();
	const bibleIds = hits.filter((h) => h.kind === "bible").map((h) => h.id);
	const workIds = hits.filter((h) => h.kind === "works").map((h) => h.id);
	const corpora = new Map((await listCorpora(db)).map((c) => [c.id, c]));
	const [b, w] = await Promise.all([
		bibleIds.length
			? db
					.select({
						id: bibleChunks.id,
						bookCode: bibleChunks.bookCode,
						chapter: bibleChunks.chapter,
						verseStart: bibleChunks.verseStart,
						verseEnd: bibleChunks.verseEnd,
						text: bibleChunks.text,
					})
					.from(bibleChunks)
					.where(inArray(bibleChunks.id, bibleIds))
			: [],
		workIds.length
			? db
					.select({
						id: scriptureChunks.id,
						corpusId: scriptureChunks.corpusId,
						label: scriptureChunks.label,
						text: scriptureChunks.text,
						anchor: scriptureChunks.anchor,
					})
					.from(scriptureChunks)
					.where(inArray(scriptureChunks.id, workIds))
			: [],
	]);
	for (const c of b) {
		const start = formatBibleReference(c.bookCode, c.chapter, c.verseStart) ?? c.id;
		out.set(c.id, {
			work: BIBLE_WORK,
			reference: c.verseEnd > c.verseStart ? `${start}-${c.verseEnd}` : start,
			text: c.text,
			url: bibleUrl(c.bookCode, c.chapter, c.verseStart),
			chunk: { bible: true, id: c.id },
		});
	}
	for (const c of w) {
		const corpus = corpora.get(c.corpusId);
		if (!corpus) continue;
		out.set(c.id, {
			work: { id: corpus.slug, title: corpus.title, tradition: corpus.religion },
			reference: c.label,
			text: c.text,
			url: scriptureUrl(corpus.id, c.label, c.text, c.anchor),
			chunk: { bible: false, id: c.id },
		});
	}
	return out;
}

/** The 10 nearest Urantia paragraphs of one unit. Null when the ref names no unit or more than one. */
export async function workParallels(
	db: Db,
	work: string,
	ref: string,
): Promise<(WorkResult & { urantiaParallels: UrantiaParallel[] }) | null | "many"> {
	const units = await readWork(db, ref, work);
	if (!units || units.length === 0) return null;
	if (units.length > 1) return "many";
	const [one] = await withParallels(db, units, 10);
	return one ?? null;
}

export type OtherWorkParallel = Omit<WorkResult, "urantiaParallels"> & { similarity: number };
export type OtherWorkParallels = Omit<WorkResult, "urantiaParallels"> & {
	chunk: { label: string; references: string[] };
	parallels: OtherWorkParallel[];
};

/** The nearest passages of the other works and of the Bible for the chunk of one unit, nearest first. */
// A Bible chunk is no source in `scripture_work_parallels`: its parallels are the work passages that have it
// in their own top 10, the nearest first.
async function bibleWorkParallels(
	db: Db,
	unit: Omit<Unit, "chunk">,
	chunkId: string,
): Promise<OtherWorkParallels> {
	let rows: { chunkId: string; similarity: number }[] = [];
	try {
		rows = await db
			.select({
				chunkId: scriptureWorkParallels.chunkId,
				similarity: scriptureWorkParallels.similarity,
			})
			.from(scriptureWorkParallels)
			.where(eq(scriptureWorkParallels.otherBibleChunkId, chunkId))
			.orderBy(desc(scriptureWorkParallels.similarity))
			.limit(10);
	} catch (error) {
		if (!isUndefinedTable(error)) throw error;
	}
	const hits = rows.map((r) => ({
		kind: "works" as const,
		id: r.chunkId,
		similarity: r.similarity,
	}));
	const [found, verses] = await Promise.all([
		chunksById(db, [...hits, { kind: "bible", id: chunkId }]),
		db
			.select({
				bookCode: bibleVerses.bookCode,
				chapter: bibleVerses.chapter,
				verse: bibleVerses.verse,
			})
			.from(bibleVerses)
			.where(eq(bibleVerses.chunkId, chunkId))
			.orderBy(asc(bibleVerses.verse)),
	]);
	const parallels = hits.flatMap((h) => {
		const other = found.get(h.id);
		if (!other) return [];
		const { chunk: _, ...rest } = other;
		return [{ ...rest, similarity: h.similarity }];
	});
	return {
		...unit,
		chunk: {
			label: found.get(chunkId)?.reference ?? unit.reference,
			references: verses.map(
				(v) => formatBibleReference(v.bookCode, v.chapter, v.verse) ?? unit.reference,
			),
		},
		parallels,
	};
}

export async function otherWorkParallels(
	db: Db,
	work: string,
	ref: string,
): Promise<OtherWorkParallels | null | "many"> {
	const units = await readWork(db, ref, work);
	if (!units || units.length === 0) return null;
	if (units.length > 1) return "many";
	const { chunk, ...unit } = units[0] as Unit;
	if (!chunk)
		return {
			...unit,
			chunk: { label: unit.reference, references: [unit.reference] },
			parallels: [],
		};
	if (chunk.bible) return bibleWorkParallels(db, unit, chunk.id);
	const [own, members] = await Promise.all([
		db
			.select({ label: scriptureChunks.label })
			.from(scriptureChunks)
			.where(eq(scriptureChunks.id, chunk.id)),
		db
			.select({ ref: scripturePassages.ref })
			.from(scripturePassages)
			.where(eq(scripturePassages.chunkId, chunk.id))
			.orderBy(asc(scripturePassages.sort)),
	]);
	let rows: {
		otherChunkId: string | null;
		otherBibleChunkId: string | null;
		similarity: number;
	}[] = [];
	try {
		rows = await db
			.select({
				otherChunkId: scriptureWorkParallels.otherChunkId,
				otherBibleChunkId: scriptureWorkParallels.otherBibleChunkId,
				similarity: scriptureWorkParallels.similarity,
			})
			.from(scriptureWorkParallels)
			.where(eq(scriptureWorkParallels.chunkId, chunk.id))
			.orderBy(asc(scriptureWorkParallels.rank));
	} catch (error) {
		// Before the table exists (42P01, undefined table) a unit has no parallels of other works.
		if (!isUndefinedTable(error)) throw error;
	}
	const hits = rows.map((r) =>
		r.otherBibleChunkId
			? { kind: "bible" as const, id: r.otherBibleChunkId, similarity: r.similarity }
			: { kind: "works" as const, id: r.otherChunkId as string, similarity: r.similarity },
	);
	const found = await chunksById(db, hits);
	const parallels = hits.flatMap((h) => {
		const other = found.get(h.id);
		if (!other) return [];
		const { chunk: _, ...rest } = other;
		return [{ ...rest, similarity: h.similarity }];
	});
	return {
		...unit,
		chunk: { label: own[0]?.label ?? unit.reference, references: members.map((m) => m.ref) },
		parallels,
	};
}

function isUndefinedTable(error: unknown): boolean {
	for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
		if ((e as { code?: string }).code === "42P01") return true;
	}
	return false;
}
