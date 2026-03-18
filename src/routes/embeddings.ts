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

// --- Bulk export (defined first so /export isn't captured by /{ref}) ---

const ExportQuery = z.object({
	format: z.enum(["jsonl", "json"]).default("jsonl"),
	paperId: z.string(),
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
	const { format, paperId } = c.req.valid("query");

	const conditions = [isNotNull(paragraphs.embedding), eq(paragraphs.paperId, paperId)];

	const whereClause = and(...conditions);

	const rows = await db
		.select({
			standardReferenceId: paragraphs.standardReferenceId,
			embedding: paragraphs.embedding,
		})
		.from(paragraphs)
		.where(whereClause)
		.orderBy(paragraphs.sortId);

	const parseEmbedding = (e: unknown) =>
		typeof e === "string" ? JSON.parse(e as string) : e;

	if (format === "json") {
		const data = rows.map((r) => ({
			ref: r.standardReferenceId,
			embedding: parseEmbedding(r.embedding),
		}));
		return c.json({ data }, 200);
	}

	// JSONL
	const lines = rows.map(
		(r) => JSON.stringify({ ref: r.standardReferenceId, embedding: parseEmbedding(r.embedding) }),
	);
	const body = `${lines.join("\n")}\n`;

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "application/x-ndjson",
			"Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
		},
	});
});

// --- Single embedding ---

const EmbeddingResponse = z.object({
	data: z.object({
		ref: z.string(),
		model: z.string(),
		dimensions: z.number().int(),
		embedding: z.array(z.number()),
	}),
});

const getEmbeddingRoute = createRoute({
	operationId: "getEmbedding",
	method: "get",
	path: "/{ref}",
	tags: ["Embeddings"],
	summary: "Get the embedding vector for a paragraph",
	description:
		"Returns the 1536-dimensional embedding vector for a single paragraph. Useful for building custom similarity search or clustering.",
	request: {
		params: ParagraphRefParam,
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
			embedding: paragraphs.embedding,
		})
		.from(paragraphs)
		.where(eq(col, ref))
		.limit(1);

	if (result.length === 0) {
		return problemJson(c, 404, `Paragraph "${ref}" not found`);
	}

	const row = result[0]!;

	if (!row.embedding) {
		return problemJson(c, 404, `No embedding available for paragraph "${ref}"`);
	}

	// pgvector returns embedding as a string like "[0.01,-0.02,...]" — parse to number array
	const embedding =
		typeof row.embedding === "string"
			? JSON.parse(row.embedding as string)
			: row.embedding;

	return c.json(
		{
			data: {
				ref: row.standardReferenceId,
				model: "text-embedding-3-small",
				dimensions: 1536,
				embedding,
			},
		},
		200,
	);
});
