// Semantic search of the Papers, shared by GET/POST /search/semantic and the MCP tool `search.semantic`.
// A whole reference gives its paragraphs. A pasted paragraph (25 words or more) gives itself first.
// The list is the 100 nearest paragraphs (`meta.total`); `meta.related` counts those that are `related` or better.
import { and, inArray, type SQL, sql } from "drizzle-orm";
import { paragraphs } from "../db/schema.ts";
import { columns, referenceWhere } from "./paper-search.ts";
import { type Strength, strengthOf } from "./search-strength.ts";
import { normalizeQuery, type PaperRef, parsePaperRef } from "./search-text.ts";
import { parsePaperRefEs } from "./search-text-es.ts";
import { type Db, matchText } from "./search-words.ts";
import { applyParagraphTranslations, applyTitleTranslations } from "./translations.ts";

export type SemanticMatch = "reference" | "exact" | "similar";
export type PaperSemanticOptions = {
	q: string;
	page: number;
	limit: number;
	paperId?: string;
	partId?: string;
	/** "es": the rows get the Spanish text and titles, and `strength` uses the Spanish gap. The vector is the same. */
	lang?: "eng" | "es";
	/** The vector of the query. Called only when the query is not a reference. */
	embed: () => Promise<number[] | null>;
};

export const MAX_RESULTS = 100;
// A query this long that a paragraph holds word for word is a pasted paragraph.
const PASTED_WORDS = 25;

type Row = Awaited<ReturnType<typeof rowsFor>>[number];
export type PaperSemanticResult = {
	data: (Row & { similarity: number; strength: Strength; match: SemanticMatch })[];
	meta: { page: number; limit: number; total: number; totalPages: number; related: number };
};

const rowsFor = (db: Db, where: SQL) => db.select(columns(null)).from(paragraphs).where(where);

/** The reference in a query, read as keyword search reads it in the same language. */
export function referenceIn(q: string, lang: "eng" | "es"): PaperRef | null {
	return lang === "es" ? parsePaperRefEs(q) : parsePaperRef(q);
}

/** Null when the query has no vector (the embedding call failed). */
export async function semanticSearchPapers(
	db: Db,
	opts: PaperSemanticOptions,
): Promise<PaperSemanticResult | null> {
	const { q, page, limit } = opts;
	const lang = opts.lang ?? "eng";
	// English rows stay as they are; Spanish rows get the translated text, titles, and labels.
	const localize = async <T extends Row>(rows: T[]): Promise<T[]> =>
		lang === "es"
			? ((await applyTitleTranslations(
					db,
					await applyParagraphTranslations(db, rows, lang),
					lang,
				)) as T[])
			: rows;
	const filters: SQL[] = [];
	if (opts.paperId) filters.push(sql`${paragraphs.paperId} = ${opts.paperId}`);
	if (opts.partId) filters.push(sql`${paragraphs.partId} = ${opts.partId}`);
	const meta = (total: number, related: number) => ({
		page,
		limit,
		total,
		totalPages: Math.ceil(total / limit),
		related,
	});

	const ref = referenceIn(q, lang);
	if (ref) {
		const where = and(referenceWhere(ref), ...filters) as SQL;
		const [rows, [n]] = await Promise.all([
			rowsFor(db, where)
				.orderBy(paragraphs.sortId)
				.limit(limit)
				.offset(page * limit),
			db.select({ n: sql<number>`count(*)::int` }).from(paragraphs).where(where),
		]);
		return {
			data: (await localize(rows)).map((r) => ({
				...r,
				similarity: 1,
				strength: "strong" as const,
				match: "reference" as const,
			})),
			meta: meta(Number(n?.n ?? 0), Number(n?.n ?? 0)),
		};
	}

	const vector = await opts.embed();
	if (!vector) return null;
	const v = `[${vector.join(",")}]`;
	const nq = normalizeQuery(q);

	// The ids of the nearest paragraphs, in order. ef_search 100, so the index gives 100 (its default is 40).
	const ranked = await db.transaction(async (tx) => {
		await tx.execute(sql`set local hnsw.ef_search = ${sql.raw(String(MAX_RESULTS))}`);
		const near = (await tx.execute(sql`
			select id, 1 - (embedding <=> ${v}::vector) as similarity from paragraphs
			where embedding is not null ${filters.length ? sql`and ${and(...filters)}` : sql``}
			order by embedding <=> ${v}::vector limit ${MAX_RESULTS}`)) as unknown as {
			id: string;
			similarity: number;
		}[];
		if (nq.words.length < PASTED_WORDS) return near.map((r) => ({ ...r, exact: false }));
		const [pasted] = (await tx.execute(sql`
			select id, 1 - (embedding <=> ${v}::vector) as similarity from paragraphs
			where ${matchText("text")} like ${`% ${nq.text} %`} ${filters.length ? sql`and ${and(...filters)}` : sql``}
			order by sort_id limit 1`)) as unknown as { id: string; similarity: number }[];
		const rest = near.filter((r) => r.id !== pasted?.id).map((r) => ({ ...r, exact: false }));
		return pasted ? [{ ...pasted, exact: true }, ...rest].slice(0, MAX_RESULTS) : rest;
	});

	const slice = ranked.slice(page * limit, page * limit + limit);
	const related = ranked.filter(
		(r) => r.exact || strengthOf(Number(r.similarity), "papers", lang) !== "weak",
	).length;
	if (slice.length === 0) return { data: [], meta: meta(ranked.length, related) };
	const byId = new Map(
		(
			await localize(
				await rowsFor(
					db,
					inArray(
						paragraphs.id,
						slice.map((r) => r.id),
					),
				),
			)
		).map((r) => [r.id, r]),
	);
	const data = slice.flatMap((r) => {
		const row = byId.get(r.id);
		if (!row) return [];
		const similarity = Number(r.similarity);
		return [
			{
				...row,
				similarity,
				strength: r.exact ? ("strong" as const) : strengthOf(similarity, "papers", lang),
				match: r.exact ? ("exact" as const) : ("similar" as const),
			},
		];
	});
	return { data, meta: meta(ranked.length, related) };
}
