import { createRoute } from "@hono/zod-openapi";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import OpenAI from "openai";
import { getDb } from "../db/client.ts";
import {
	paragraphs,
	scriptureChunks,
	scriptureParallels,
	scripturePassages,
} from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import {
	corpusSummary,
	listCorpora,
	resolveCorpus,
	type ScriptureCorpus,
} from "../lib/scripture-parallels.ts";
import { parseScriptureRef } from "../lib/scripture-ref.ts";
import { getCachedEmbedding, runAfter, setCachedEmbedding } from "../lib/search-cache.ts";
import {
	ErrorResponse,
	ScriptureCorporaResponse,
	ScriptureCorpusParam,
	ScriptureCorpusResponse,
	ScripturePassagesResponse,
	ScriptureRefParam,
	ScriptureSemanticSearchRequest,
	ScriptureSemanticSearchResponse,
	ScriptureUrantiaParallelsResponse,
} from "../validators/schemas.ts";

export const scripturesRoute = createApp();

const PARALLELS_NOTE =
	"**These are semantic parallels, not curated ones.** They show the passages closest in meaning by embedding similarity. They do not claim that two teachings are the same.";

const errors = {
	404: {
		description: "Corpus or passage not found",
		content: { "application/json": { schema: ErrorResponse } },
	},
	500: {
		description: "Internal server error",
		content: { "application/json": { schema: ErrorResponse } },
	},
};

function corpusDetail(c: ScriptureCorpus) {
	return {
		...corpusSummary(c),
		sourceUrl: c.sourceUrl,
		license: c.license,
		divisionLabel: c.divisionLabel,
		unitLabel: c.unitLabel,
		passageCount: c.passageCount,
		refLevels: c.refLevels,
		notes: c.notes,
	};
}

// The ref's numbers, outermost first, map to division, then subdivision (three-level
// refs only), then the passage number. A full ref matches the passages whose number
// range overlaps it, so "Dhp 59" finds the combined passage "Dhp 58-59".
function refCondition(
	corpus: ScriptureCorpus,
	ref: NonNullable<ReturnType<typeof parseScriptureRef>>,
): SQL {
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

const passageFields = {
	id: scripturePassages.id,
	ref: scripturePassages.ref,
	division: scripturePassages.division,
	divisionTitle: scripturePassages.divisionTitle,
	subdivision: scripturePassages.subdivision,
	text: scripturePassages.text,
	chunkId: scripturePassages.chunkId,
};

// GET /scriptures — the corpora
const listRoute = createRoute({
	operationId: "listScriptures",
	method: "get",
	path: "/",
	tags: ["Scriptures"],
	summary: "List the world religions texts",
	description:
		'Returns every scripture corpus with its religion, translator, year, source, and license. Each text is in the US public domain. `urantiaSection` names the section of Paper 131, "The World\'s Religions", that summarizes the religion. The Bible has its own endpoints under `/bible`.',
	responses: {
		200: {
			description: "The corpora",
			content: { "application/json": { schema: ScriptureCorporaResponse } },
		},
		500: errors[500],
	},
});

scripturesRoute.openapi(listRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	return c.json({ data: (await listCorpora(db)).map(corpusDetail) }, 200);
});

// GET /scriptures/{corpus} — one corpus with its chapters or books
const corpusRoute = createRoute({
	operationId: "getScripture",
	method: "get",
	path: "/{corpus}",
	tags: ["Scriptures"],
	summary: "Get one text and its chapters",
	description:
		"Returns the corpus facts and its divisions (chapters, or books for the Analects), each with its first and last reference. The corpus accepts its id, slug, or ref prefix: `bhagavad-gita`, `bg`, and `bhagavad-gita-besant-1922` all work.",
	request: { params: ScriptureCorpusParam },
	responses: {
		200: {
			description: "The corpus",
			content: { "application/json": { schema: ScriptureCorpusResponse } },
		},
		...errors,
	},
});

scripturesRoute.openapi(corpusRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const corpus = await resolveCorpus(db, c.req.valid("param").corpus);
	if (!corpus) return problemJson(c, 404, `Scripture "${c.req.valid("param").corpus}" not found`);
	const rows = await db
		.select({
			division: scripturePassages.division,
			title: sql<string | null>`min(${scripturePassages.divisionTitle})`,
			firstRef: sql<string>`(array_agg(${scripturePassages.ref} ORDER BY ${scripturePassages.sort}))[1]`,
			lastRef: sql<string>`(array_agg(${scripturePassages.ref} ORDER BY ${scripturePassages.sort} DESC))[1]`,
			passageCount: sql<number>`count(*)::int`,
		})
		.from(scripturePassages)
		.where(eq(scripturePassages.corpusId, corpus.id))
		.groupBy(scripturePassages.division)
		.orderBy(asc(scripturePassages.division));
	return c.json({ data: { ...corpusDetail(corpus), divisions: rows } }, 200);
});

// GET /scriptures/{corpus}/{ref} — a passage, a short range, or a chapter
const passagesRoute = createRoute({
	operationId: "getScripturePassages",
	method: "get",
	path: "/{corpus}/{ref}",
	tags: ["Scriptures"],
	summary: "Get scripture passages by reference",
	description:
		"Returns the passages for a reference. Use `2.47` (chapter and verse), `2.47-49` (a range of up to 50), or `2` (a whole chapter). Each text has its own number of levels (`refLevels`): the Dhammapada, the Japji, and the Shinto oracles have one (`Dhp 183`), Epictetus has three (`Epictetus 3.22.5`), and the others have two. A ref with fewer numbers names a whole part, such as `Epictetus 3.22`. The ref prefix is optional: `BG 2.47` and `2.47` are the same.",
	request: { params: ScriptureRefParam },
	responses: {
		200: {
			description: "The passages",
			content: { "application/json": { schema: ScripturePassagesResponse } },
		},
		400: {
			description: "Invalid reference",
			content: { "application/json": { schema: ErrorResponse } },
		},
		...errors,
	},
});

scripturesRoute.openapi(passagesRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const params = c.req.valid("param");
	const corpus = await resolveCorpus(db, params.corpus);
	if (!corpus) return problemJson(c, 404, `Scripture "${params.corpus}" not found`);
	const ref = parseScriptureRef(params.ref, corpus.refPrefix, corpus.refLevels);
	if (!ref)
		return problemJson(
			c,
			400,
			`Invalid reference "${params.ref}" for ${corpus.title}`,
			"invalid-reference-format",
		);
	const rows = await db
		.select(passageFields)
		.from(scripturePassages)
		.where(refCondition(corpus, ref))
		.orderBy(asc(scripturePassages.sort))
		.limit(200);
	if (rows.length === 0) return problemJson(c, 404, `${corpus.refPrefix} ${params.ref} not found`);
	return c.json(
		{ data: { corpus: corpusSummary(corpus), passages: rows.map(({ chunkId: _, ...p }) => p) } },
		200,
	);
});

// GET /scriptures/{corpus}/{ref}/urantia-parallels
const parallelsRoute = createRoute({
	operationId: "getScriptureUrantiaParallels",
	method: "get",
	path: "/{corpus}/{ref}/urantia-parallels",
	tags: ["Scriptures"],
	summary: "Top 10 Urantia paragraphs for a scripture passage",
	description: `Returns the 10 Urantia paragraphs closest in meaning to the chunk that holds this passage. A chunk is a group of passages of about one Urantia paragraph in length. Pre-computed with \`text-embedding-3-large\` (3072-d) cosine similarity. The ref must name one passage.\n\n${PARALLELS_NOTE}`,
	request: { params: ScriptureRefParam },
	responses: {
		200: {
			description: "The passage with its top 10 Urantia paragraphs",
			content: { "application/json": { schema: ScriptureUrantiaParallelsResponse } },
		},
		400: {
			description: "Invalid reference, or more than one passage",
			content: { "application/json": { schema: ErrorResponse } },
		},
		...errors,
	},
});

scripturesRoute.openapi(parallelsRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const params = c.req.valid("param");
	const corpus = await resolveCorpus(db, params.corpus);
	if (!corpus) return problemJson(c, 404, `Scripture "${params.corpus}" not found`);
	const ref = parseScriptureRef(params.ref, corpus.refPrefix, corpus.refLevels);
	if (!ref)
		return problemJson(
			c,
			400,
			`Invalid reference "${params.ref}" for ${corpus.title}`,
			"invalid-reference-format",
		);
	const rows = await db
		.select(passageFields)
		.from(scripturePassages)
		.where(refCondition(corpus, ref))
		.orderBy(asc(scripturePassages.sort))
		.limit(2);
	const passage = rows[0];
	if (!passage) return problemJson(c, 404, `${corpus.refPrefix} ${params.ref} not found`);
	if (rows.length > 1)
		return problemJson(
			c,
			400,
			`${corpus.refPrefix} ${params.ref} names more than one passage. Ask for one passage, such as ${passage.ref}.`,
			"invalid-reference-format",
		);
	if (!passage.chunkId) return problemJson(c, 404, `${passage.ref} has no chunk yet`);

	const [chunk] = await db
		.select({
			id: scriptureChunks.id,
			reference: scriptureChunks.label,
			text: scriptureChunks.text,
		})
		.from(scriptureChunks)
		.where(eq(scriptureChunks.id, passage.chunkId))
		.limit(1);
	if (!chunk) return problemJson(c, 404, `Chunk ${passage.chunkId} not found`);

	const top = await db
		.select({
			id: paragraphs.id,
			standardReferenceId: paragraphs.standardReferenceId,
			paperId: paragraphs.paperId,
			paperTitle: paragraphs.paperTitle,
			sectionTitle: paragraphs.sectionTitle,
			text: paragraphs.text,
			similarity: scriptureParallels.similarity,
			rank: scriptureParallels.rank,
		})
		.from(scriptureParallels)
		.innerJoin(paragraphs, eq(scriptureParallels.paragraphId, paragraphs.id))
		.where(
			and(
				eq(scriptureParallels.chunkId, chunk.id),
				eq(scriptureParallels.direction, "scripture_to_ub"),
			),
		)
		.orderBy(asc(scriptureParallels.rank));

	const { chunkId: _, ...passageOut } = passage;
	return c.json(
		{ data: { corpus: corpusSummary(corpus), passage: passageOut, chunk, urantiaParallels: top } },
		200,
	);
});

// POST /scriptures/search/semantic
const searchRoute = createRoute({
	operationId: "scriptureSemanticSearch",
	method: "post",
	path: "/search/semantic",
	tags: ["Scriptures"],
	summary: "Semantic search across the world religions texts",
	description: `Natural-language search across every scripture chunk, or one corpus with \`corpus\`. Each result carries its top Urantia paragraphs (\`urantiaParallelLimit\`, 0 to 10, default 3). The query is embedded with \`text-embedding-3-small\` and matched with a pgvector HNSW index.\n\n${PARALLELS_NOTE}`,
	request: {
		body: {
			required: true,
			content: { "application/json": { schema: ScriptureSemanticSearchRequest } },
		},
	},
	responses: {
		200: {
			description: "Search results",
			content: { "application/json": { schema: ScriptureSemanticSearchResponse } },
		},
		400: {
			description: "Invalid request",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: errors[500],
	},
});

scripturesRoute.openapi(searchRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const kv = c.env?.SEARCH_CACHE as KVNamespace | undefined;
	const { q, corpus: corpusName, page, limit, urantiaParallelLimit } = c.req.valid("json");

	const corpora = await listCorpora(db);
	let corpusId: string | undefined;
	if (corpusName) {
		const found = await resolveCorpus(db, corpusName);
		if (!found) return problemJson(c, 400, `Scripture "${corpusName}" not found`);
		corpusId = found.id;
	}

	let vector = await getCachedEmbedding(kv, q);
	if (!vector) {
		const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
		const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: q });
		const v = res.data[0]?.embedding;
		if (!v) return problemJson(c, 500, "Failed to generate embedding");
		vector = v;
		runAfter(c, setCachedEmbedding(kv, q, v));
	}
	const vectorStr = `[${vector.join(",")}]`;
	const filter = corpusId ? sql`AND corpus_id = ${corpusId}` : sql``;

	const [countRows, resultRows] = await Promise.all([
		db.execute(
			sql`SELECT count(*)::int AS n FROM scripture_chunks WHERE embedding_small IS NOT NULL ${filter}`,
		),
		db.execute(sql`
			SELECT id, corpus_id, label, text,
			       (1 - (embedding_small <=> ${vectorStr}::vector))::real AS similarity
			FROM scripture_chunks
			WHERE embedding_small IS NOT NULL ${filter}
			ORDER BY embedding_small <=> ${vectorStr}::vector ASC
			LIMIT ${limit} OFFSET ${page * limit}`),
	]);
	const total = Number((countRows as unknown as { n: number }[])[0]?.n ?? 0);
	const hits = resultRows as unknown as {
		id: string;
		corpus_id: string;
		label: string;
		text: string;
		similarity: number;
	}[];

	type UbParallel = {
		id: string;
		standardReferenceId: string;
		paperId: string;
		paperTitle: string;
		sectionTitle: string | null;
		text: string;
		similarity: number;
		rank: number;
	};
	const byChunk = new Map<string, UbParallel[]>();
	if (hits.length && urantiaParallelLimit > 0) {
		const rows = await db
			.select({
				chunkId: scriptureParallels.chunkId,
				id: paragraphs.id,
				standardReferenceId: paragraphs.standardReferenceId,
				paperId: paragraphs.paperId,
				paperTitle: paragraphs.paperTitle,
				sectionTitle: paragraphs.sectionTitle,
				text: paragraphs.text,
				similarity: scriptureParallels.similarity,
				rank: scriptureParallels.rank,
			})
			.from(scriptureParallels)
			.innerJoin(paragraphs, eq(scriptureParallels.paragraphId, paragraphs.id))
			.where(
				and(
					eq(scriptureParallels.direction, "scripture_to_ub"),
					inArray(
						scriptureParallels.chunkId,
						hits.map((h) => h.id),
					),
					sql`${scriptureParallels.rank} <= ${urantiaParallelLimit}`,
				),
			)
			.orderBy(asc(scriptureParallels.chunkId), asc(scriptureParallels.rank));
		for (const { chunkId, ...p } of rows)
			byChunk.set(chunkId, [...(byChunk.get(chunkId) ?? []), p]);
	}

	const byId = new Map(corpora.map((x) => [x.id, x]));
	const data = hits.flatMap((h) => {
		const corpus = byId.get(h.corpus_id);
		if (!corpus) return [];
		return [
			{
				chunkId: h.id,
				reference: h.label,
				corpus: corpusSummary(corpus),
				text: h.text,
				similarity: h.similarity,
				urantiaParallels: byChunk.get(h.id) ?? [],
			},
		];
	});
	return c.json({ data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }, 200);
});
