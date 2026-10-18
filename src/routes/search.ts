import { createRoute } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";

// biome-ignore lint: Handler context type varies per route; using `any` avoids
// duplicating the full typed-response signature for each GET/POST pair.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContext = any;

import OpenAI from "openai";
import { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { enrichWithBibleParallels, wantsBibleParallels } from "../lib/bible-parallels.ts";
import { enrichWithEntities, wantsEntities } from "../lib/entities.ts";
import { problemJson } from "../lib/errors.ts";
import { type SearchType, searchPapers, tierCounts } from "../lib/paper-search.ts";
import { semanticSearchPapers } from "../lib/paper-semantic.ts";
import { getCachedEmbedding, runAfter, setCachedEmbedding } from "../lib/search-cache.ts";
import { normalizeQuery } from "../lib/search-text.ts";
import { enrichWithUrantiaParallels, wantsUrantiaParallels } from "../lib/urantia-parallels.ts";
import {
	ErrorResponse,
	SearchQueryParams,
	SearchRequest,
	SearchResponse,
	SemanticSearchQueryParams,
	SemanticSearchRequest,
	SemanticSearchResponse,
} from "../validators/schemas.ts";

export const searchRoute = createApp();

// ── Shared handler: Full-text search ──

type SearchParams = {
	q: string;
	page: number;
	limit: number;
	paperId?: string;
	partId?: string;
	type: SearchType;
	include?: string;
};

async function handleFullTextSearch(c: AnyContext, params: SearchParams) {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { q, page, limit, paperId, partId, type, include } = params;

	if (!q) {
		return problemJson(c, 400, "Search query cannot be empty");
	}

	if (normalizeQuery(q).words.length === 0) {
		return problemJson(c, 400, "Search query cannot be empty");
	}

	const { data: results, meta } = await searchPapers(db, { q, type, page, limit, paperId, partId });
	const total = meta.total;

	const logger = c.get("logger");
	if (logger) {
		logger.info("search", {
			query: q,
			search_type: type,
			paper_id: paperId ?? undefined,
			part_id: partId ?? undefined,
			result_count: total,
			first_match: results[0]?.match,
			tier_counts: tierCounts(results),
		});
	}

	type Enriched = (typeof results)[number] & {
		entities?: Awaited<ReturnType<typeof enrichWithEntities>>[number]["entities"];
		bibleParallels?: Awaited<ReturnType<typeof enrichWithBibleParallels>>[number]["bibleParallels"];
		urantiaParallels?: Awaited<
			ReturnType<typeof enrichWithUrantiaParallels>
		>[number]["urantiaParallels"];
	};
	let enrichedResults: Enriched[] = results;
	if (wantsEntities(include))
		enrichedResults = (await enrichWithEntities(db, enrichedResults)) as Enriched[];
	if (wantsBibleParallels(include))
		enrichedResults = (await enrichWithBibleParallels(db, enrichedResults)) as Enriched[];
	if (wantsUrantiaParallels(include))
		enrichedResults = (await enrichWithUrantiaParallels(db, enrichedResults)) as Enriched[];

	return c.json(
		{
			data: enrichedResults,
			meta,
		},
		200,
	);
}

// ── Shared handler: Semantic search ──

type SemanticSearchParams = {
	q: string;
	page: number;
	limit: number;
	paperId?: string;
	partId?: string;
	include?: string;
};

async function handleSemanticSearch(c: AnyContext, params: SemanticSearchParams) {
	const startTotal = performance.now();

	const { db } = getDb(c.env?.HYPERDRIVE);
	const kv = c.env?.SEARCH_CACHE as KVNamespace | undefined;
	const { q, page, limit, paperId, partId, include } = params;

	if (!q) {
		return problemJson(c, 400, "Search query cannot be empty");
	}

	let embeddingMs = 0;
	let embeddingCacheHit = false;
	const embed = async () => {
		const startEmbedding = performance.now();
		let vector = await getCachedEmbedding(kv, q);
		embeddingCacheHit = vector !== null;
		if (!vector) {
			const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
			const embeddingResponse = await openai.embeddings.create({
				model: "text-embedding-3-small",
				input: q,
			});
			vector = embeddingResponse.data[0]?.embedding ?? null;
			if (vector) runAfter(c, setCachedEmbedding(kv, q, vector));
		}
		embeddingMs = Math.round(performance.now() - startEmbedding);
		return vector;
	};

	const startQueries = performance.now();
	const found = await semanticSearchPapers(db, { q, page, limit, paperId, partId, embed });
	if (!found) {
		return problemJson(c, 500, "Failed to generate embedding");
	}
	const queriesMs = Math.round(performance.now() - startQueries) - embeddingMs;
	const { data: results, meta } = found;

	type Enriched = (typeof results)[number] & {
		entities?: Awaited<ReturnType<typeof enrichWithEntities>>[number]["entities"];
		bibleParallels?: Awaited<ReturnType<typeof enrichWithBibleParallels>>[number]["bibleParallels"];
		urantiaParallels?: Awaited<
			ReturnType<typeof enrichWithUrantiaParallels>
		>[number]["urantiaParallels"];
	};
	let enrichMs = 0;
	let enrichedResults: Enriched[] = results;
	const startEnrich = performance.now();
	if (wantsEntities(include))
		enrichedResults = (await enrichWithEntities(db, enrichedResults)) as Enriched[];
	if (wantsBibleParallels(include))
		enrichedResults = (await enrichWithBibleParallels(db, enrichedResults)) as Enriched[];
	if (wantsUrantiaParallels(include))
		enrichedResults = (await enrichWithUrantiaParallels(db, enrichedResults)) as Enriched[];
	if (wantsEntities(include) || wantsBibleParallels(include) || wantsUrantiaParallels(include)) {
		enrichMs = Math.round(performance.now() - startEnrich);
	}

	const totalMs = Math.round(performance.now() - startTotal);

	const logger = c.get("logger");
	if (logger) {
		logger.info("semantic_search", {
			query: q,
			paper_id: paperId ?? undefined,
			part_id: partId ?? undefined,
			result_count: meta.total,
			first_match: results[0]?.match,
			first_strength: results[0]?.strength,
			cache: {
				embedding_hit: embeddingCacheHit,
			},
			timing: {
				embedding_ms: embeddingMs,
				db_queries_ms: queriesMs,
				enrichment_ms: enrichMs,
				total_ms: totalMs,
			},
		});
	}

	return c.json({ data: enrichedResults, meta }, 200);
}

const searchDescription = `Search the Urantia Papers by keyword. Four search modes:
- **auto** (default): a reference such as \`68:6.3\`, \`103:2\`, \`Paper 68\`, or a bare number such as \`68\` (0 to 196) gives those paragraphs. Otherwise the exact phrase comes first, then paragraphs with every word (the last word can be the start of a word). When these give fewer than 10, paragraphs with a typo fixed (\`meta.didYouMean\`) and paragraphs with most of the words follow. Each result has \`match\`.
- **and**: all words must appear
- **or**: any word can appear
- **phrase**: exact phrase match

Results are ranked by relevance. Optional filters: paperId, partId. When the query names another work, \`meta.see\` names it.`;

const searchResponses = {
	200: {
		description: "Search results with pagination",
		content: { "application/json": { schema: SearchResponse } },
	},
	400: {
		description: "Invalid search query",
		content: { "application/json": { schema: ErrorResponse } },
	},
	500: {
		description: "Internal server error",
		content: { "application/json": { schema: ErrorResponse } },
	},
};

const semanticSearchDescription = `Search the Urantia Papers using semantic similarity (vector embeddings).
Returns conceptually related results even without exact keyword matches.

A reference such as \`99:1.1\` gives those paragraphs (\`match: "reference"\`). A pasted paragraph of 25 words or more gives itself first (\`match: "exact"\`). Each result has \`strength\`: strong, related, or weak. The list holds the 100 nearest paragraphs; \`meta.total\` is the length of that list, and \`meta.related\` counts those that are related or better.

Optional filters: paperId, partId.`;

const semanticSearchResponses = {
	200: {
		description: "Semantic search results with pagination",
		content: { "application/json": { schema: SemanticSearchResponse } },
	},
	400: {
		description: "Invalid search query",
		content: { "application/json": { schema: ErrorResponse } },
	},
	500: {
		description: "Internal server error",
		content: { "application/json": { schema: ErrorResponse } },
	},
};

// ── POST /search ──

const searchPostRoute = createRoute({
	operationId: "search",
	method: "post",
	path: "/",
	tags: ["Search"],
	summary: "Full-text search across all paragraphs",
	description: searchDescription,
	request: {
		body: {
			required: true,
			content: { "application/json": { schema: SearchRequest } },
		},
	},
	responses: searchResponses,
});

searchRoute.openapi(searchPostRoute, async (c) => {
	const params = c.req.valid("json");
	// Accept ?include=... on POST as a fallback so callers who default to
	// putting opt-in flags in the URL still get enrichment.
	return handleFullTextSearch(c, { ...params, include: params.include ?? c.req.query("include") });
});

// ── GET /search ──

const searchGetRoute = createRoute({
	operationId: "searchGet",
	method: "get",
	path: "/",
	tags: ["Search"],
	summary: "Full-text search across all paragraphs (GET)",
	description: `${searchDescription}\n\nAccepts query parameters instead of a JSON body. Designed for AI agents and browser-based access.`,
	request: {
		query: SearchQueryParams,
	},
	responses: searchResponses,
});

searchRoute.openapi(searchGetRoute, async (c) => {
	const params = c.req.valid("query");
	return handleFullTextSearch(c, params);
});

// ── POST /search/semantic ──

const semanticSearchPostRoute = createRoute({
	operationId: "semanticSearch",
	method: "post",
	path: "/semantic",
	tags: ["Search"],
	summary: "Semantic similarity search across all paragraphs",
	description: semanticSearchDescription,
	request: {
		body: {
			required: true,
			content: { "application/json": { schema: SemanticSearchRequest } },
		},
	},
	responses: semanticSearchResponses,
});

searchRoute.openapi(semanticSearchPostRoute, async (c) => {
	const params = c.req.valid("json");
	return handleSemanticSearch(c, { ...params, include: params.include ?? c.req.query("include") });
});

// ── GET /search/semantic ──

const semanticSearchGetRoute = createRoute({
	operationId: "semanticSearchGet",
	method: "get",
	path: "/semantic",
	tags: ["Search"],
	summary: "Semantic similarity search across all paragraphs (GET)",
	description: `${semanticSearchDescription}\n\nAccepts query parameters instead of a JSON body. Designed for AI agents and browser-based access.`,
	request: {
		query: SemanticSearchQueryParams,
	},
	responses: semanticSearchResponses,
});

searchRoute.openapi(semanticSearchGetRoute, async (c) => {
	const params = c.req.valid("query");
	return handleSemanticSearch(c, params);
});
