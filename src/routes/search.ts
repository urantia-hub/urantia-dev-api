import { createRoute } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { enrichWithEntities, wantsEntities } from "../lib/entities.ts";
import { problemJson } from "../lib/errors.ts";
import {
	ErrorResponse,
	SearchRequest,
	SearchResponse,
	SemanticSearchRequest,
	SemanticSearchResponse,
} from "../validators/schemas.ts";

export const searchRoute = createApp();

/**
 * Build a tsquery string from the search input based on the search type.
 */
function buildTsQuery(sanitized: string, type: "phrase" | "and" | "or"): string {
	switch (type) {
		case "phrase":
			return `phraseto_tsquery('english', '${sanitized}')`;
		case "and": {
			const words = sanitized.split(/\s+/).filter(Boolean);
			return `to_tsquery('english', '${words.join(" & ")}')`;
		}
		case "or": {
			const words = sanitized.split(/\s+/).filter(Boolean);
			return `to_tsquery('english', '${words.join(" | ")}')`;
		}
	}
}

const searchParagraphsRoute = createRoute({
	operationId: "search",
	method: "post",
	path: "/",
	tags: ["Search"],
	summary: "Full-text search across all paragraphs",
	description: `Search the Urantia Papers using full-text search. Supports three search modes:
- **and**: All words must appear (default)
- **or**: Any word can appear
- **phrase**: Exact phrase match

Results are ranked by relevance. Optional filters: paperId, partId.`,
	request: {
		body: {
			content: { "application/json": { schema: SearchRequest } },
		},
	},
	responses: {
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
	},
});

searchRoute.openapi(searchParagraphsRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const body = c.req.valid("json");
	const { q, page, limit, paperId, partId, type, include } = body;

	const sanitized = q.replace(/[^\w\s]/g, " ").trim();

	if (!sanitized) {
	
		return problemJson(c, 400, "Search query cannot be empty");
	}

	const tsQuery = buildTsQuery(sanitized, type);
	const offset = page * limit;

	// Build WHERE conditions
	const conditions = [sql`search_vector @@ ${sql.raw(tsQuery)}`];

	if (paperId) {
		conditions.push(eq(paragraphs.paperId, paperId));
	}
	if (partId) {
		conditions.push(eq(paragraphs.partId, partId));
	}

	const whereClause = and(...conditions);

	// Count total matches
	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(paragraphs)
		.where(whereClause);

	const total = Number(countResult[0]?.count ?? 0);

	// Fetch results with rank and highlighted text
	const results = await db
		.select({
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
			htmlText: sql<string>`ts_headline('english', ${paragraphs.htmlText}, ${sql.raw(tsQuery)}, ${sql.raw("'StartSel=\"<span class=urantia-dev-highlighted>\", StopSel=\"</span>\", MaxFragments=0, HighlightAll=true'")})`,
			labels: paragraphs.labels,
			audio: paragraphs.audio,
			rank: sql<number>`ts_rank(search_vector, ${sql.raw(tsQuery)})`,
		})
		.from(paragraphs)
		.where(whereClause)
		.orderBy(sql`ts_rank(search_vector, ${sql.raw(tsQuery)}) DESC`)
		.limit(limit)
		.offset(offset);

	const logger = c.get("logger");
	if (logger) {
		logger.info("search", {
			query: q,
			search_type: type,
			paper_id: paperId ?? undefined,
			part_id: partId ?? undefined,
			result_count: total,
		});
	}

	const enrichedResults = wantsEntities(include)
		? await enrichWithEntities(db, results)
		: results;



	return c.json(
		{
			data: enrichedResults,
			meta: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		},
		200,
	);
});

// ── Semantic Search ──

const semanticSearchRoute = createRoute({
	operationId: "semanticSearch",
	method: "post",
	path: "/semantic",
	tags: ["Search"],
	summary: "Semantic similarity search across all paragraphs",
	description: `Search the Urantia Papers using semantic similarity (vector embeddings).
Returns conceptually related results even without exact keyword matches.
Optional filters: paperId, partId.`,
	request: {
		body: {
			content: { "application/json": { schema: SemanticSearchRequest } },
		},
	},
	responses: {
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
	},
});

searchRoute.openapi(semanticSearchRoute, async (c) => {
	const startTotal = performance.now();

	const { db } = getDb(c.env?.HYPERDRIVE);
	const { q, page, limit, paperId, partId, include } = c.req.valid("json");
	const offset = page * limit;

	const startEmbedding = performance.now();
	const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	const embeddingResponse = await openai.embeddings.create({
		model: "text-embedding-3-small",
		input: q,
	});
	const embeddingMs = Math.round(performance.now() - startEmbedding);

	const queryVector = embeddingResponse.data[0]?.embedding;
	if (!queryVector) {
		return problemJson(c, 500, "Failed to generate embedding");
	}
	const vectorStr = `[${queryVector.join(",")}]`;

	// Build WHERE conditions
	const conditions = [sql`embedding IS NOT NULL`];
	if (paperId) {
		conditions.push(eq(paragraphs.paperId, paperId));
	}
	if (partId) {
		conditions.push(eq(paragraphs.partId, partId));
	}
	const whereClause = and(...conditions);

	// Run count and vector search in parallel to save a round-trip
	const startQueries = performance.now();
	const [countResult, results] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)` })
			.from(paragraphs)
			.where(whereClause),
		db
			.select({
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
				htmlText: paragraphs.htmlText,
				labels: paragraphs.labels,
				audio: paragraphs.audio,
				similarity: sql<number>`1 - (embedding <=> ${vectorStr}::vector)`,
			})
			.from(paragraphs)
			.where(whereClause)
			.orderBy(sql`embedding <=> ${vectorStr}::vector`)
			.limit(limit)
			.offset(offset),
	]);
	const queriesMs = Math.round(performance.now() - startQueries);

	const total = Number(countResult[0]?.count ?? 0);

	let enrichMs = 0;
	const enrichedResults = wantsEntities(include)
		? await (async () => {
				const startEnrich = performance.now();
				const enriched = await enrichWithEntities(db, results);
				enrichMs = Math.round(performance.now() - startEnrich);
				return enriched;
			})()
		: results;

	const totalMs = Math.round(performance.now() - startTotal);

	const logger = c.get("logger");
	if (logger) {
		logger.info("semantic_search", {
			query: q,
			paper_id: paperId ?? undefined,
			part_id: partId ?? undefined,
			result_count: total,
			timing: {
				embedding_ms: embeddingMs,
				db_queries_ms: queriesMs,
				entity_enrichment_ms: enrichMs,
				total_ms: totalMs,
			},
		});
	}

	return c.json(
		{
			data: enrichedResults,
			meta: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		},
		200,
	);
});
