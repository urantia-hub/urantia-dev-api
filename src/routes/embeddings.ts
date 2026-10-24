import { createRoute } from "@hono/zod-openapi";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { detectRefFormat } from "../types/node.ts";
import { ErrorResponse, ParagraphRefParam } from "../validators/schemas.ts";

export const embeddingsRoute = createApp();

// --- Shared query params ---

// `model` selects which embedding column to read from. The repo stores
// both 1536-d (text-embedding-3-small) and 3072-d (text-embedding-3-large)
// vectors. `large` is the new canonical model used by Phase 3
// cross-references; `small` is what /search/semantic uses for live
// HNSW-indexed UB queries.
const ModelQuery = z.enum(["small", "large"]).default("large");

const MODEL_META = {
	small: {
		name: "text-embedding-3-small",
		dimensions: 1536,
		column: paragraphs.embedding,
	},
	large: {
		name: "text-embedding-3-large",
		dimensions: 3072,
		column: paragraphs.embeddingV2,
	},
} as const;

// --- Bulk export (defined first so /export isn't captured by /{ref}) ---

const ExportQuery = z.object({
	format: z.enum(["jsonl", "json"]).default("jsonl"),
	paperId: z.string(),
	model: ModelQuery,
});

const exportEmbeddingsRoute = createRoute({
	operationId: "exportEmbeddings",
	method: "get",
	path: "/export",
	tags: ["Embeddings"],
	summary: "Bulk export embedding vectors",
	description: `Export embedding vectors for all paragraphs in a paper. The \`paperId\` query parameter is required.

Returns JSONL (default) or JSON. Each line/item contains \`{ ref, embedding }\`. A typical paper is 50-200 paragraphs (~1-5 MB).`,
	request: {
		query: ExportQuery,
	},
	responses: {
		200: {
			description: "Embedding vectors (JSONL or JSON)",
		},
	},
});

embeddingsRoute.openapi(exportEmbeddingsRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { format, paperId, model } = c.req.valid("query");
	const meta = MODEL_META[model];

	const conditions = [isNotNull(meta.column), eq(paragraphs.paperId, paperId)];

	const whereClause = and(...conditions);

	const rows = await db
		.select({
			standardReferenceId: paragraphs.standardReferenceId,
			embedding: meta.column,
		})
		.from(paragraphs)
		.where(whereClause)
		.orderBy(paragraphs.sortId);

	const parseEmbedding = (e: unknown) =>
		typeof e === "string" ? JSON.parse(e as string) : e;

	if (format === "json") {
		const data = rows.map((r) => ({
			standardReferenceId: r.standardReferenceId,
			embedding: parseEmbedding(r.embedding),
		}));
		c.header("X-Embedding-Model", meta.name);
		return c.json(
			{ data, model: meta.name, dimensions: meta.dimensions },
			200,
		);
	}

	// JSONL
	const lines = rows.map(
		(r) =>
			JSON.stringify({
				standardReferenceId: r.standardReferenceId,
				embedding: parseEmbedding(r.embedding),
			}),
	);
	const body = `${lines.join("\n")}\n`;

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "application/x-ndjson",
			"Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
			"X-Embedding-Model": meta.name,
			"X-Embedding-Dimensions": String(meta.dimensions),
		},
	});
});

// --- Single embedding ---

const EmbeddingResponse = z.object({
	data: z.object({
		standardReferenceId: z.string(),
		model: z.string(),
		dimensions: z.number().int(),
		embedding: z.array(z.number()),
	}),
});

const SingleEmbeddingQuery = z.object({ model: ModelQuery });

const getEmbeddingRoute = createRoute({
	operationId: "getEmbedding",
	method: "get",
	path: "/{ref}",
	tags: ["Embeddings"],
	summary: "Get the embedding vector for a paragraph",
	description: `Returns the embedding vector for a single paragraph.

Use \`?model=large\` (default) for the 3072-dimensional \`text-embedding-3-large\` vector — the canonical embedding used by the cross-references feature. Use \`?model=small\` for the 1536-dimensional \`text-embedding-3-small\` vector that powers \`/search/semantic\`.

The response includes \`model\` and \`dimensions\` fields so consumers can detect mismatches if they store vectors locally and compare against new responses. The \`X-Embedding-Model\` response header carries the same signal for byte-streaming clients.`,
	request: {
		params: ParagraphRefParam,
		query: SingleEmbeddingQuery,
	},
	responses: {
		200: {
			description: "Embedding vector",
			content: { "application/json": { schema: EmbeddingResponse } },
		},
		404: {
			description: "Paragraph or embedding not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

embeddingsRoute.openapi(getEmbeddingRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { ref } = c.req.valid("param");
	const { model } = c.req.valid("query");
	const meta = MODEL_META[model];
	const format = detectRefFormat(ref);

	if (format === "unknown") {
		return problemJson(c, 404, `Invalid paragraph reference: "${ref}"`);
	}

	const col =
		format === "globalId"
			? paragraphs.globalId
			: format === "standardReferenceId"
				? paragraphs.standardReferenceId
				: paragraphs.paperSectionParagraphId;

	const result = await db
		.select({
			standardReferenceId: paragraphs.standardReferenceId,
			embedding: meta.column,
		})
		.from(paragraphs)
		.where(eq(col, ref))
		.limit(1);

	if (result.length === 0) {
		return problemJson(c, 404, `Paragraph "${ref}" not found`);
	}

	const row = result[0]!;

	if (!row.embedding) {
		return problemJson(
			c,
			404,
			`No ${meta.name} embedding available for paragraph "${ref}"`,
		);
	}

	const embedding =
		typeof row.embedding === "string"
			? JSON.parse(row.embedding as string)
			: row.embedding;

	c.header("X-Embedding-Model", meta.name);
	return c.json(
		{
			data: {
				standardReferenceId: row.standardReferenceId,
				model: meta.name,
				dimensions: meta.dimensions,
				embedding,
			},
		},
		200,
	);
});
