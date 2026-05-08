import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, gt, ilike, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import OpenAI from "openai";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import {
	bibleChunks,
	bibleParallels,
	bibleVerses,
	entities,
	papers,
	paragraphEntities,
	paragraphs,
	parts,
	sections,
} from "../db/schema.ts";
import { BIBLE_BOOKS, formatBibleReference, resolveBibleBook } from "../lib/bible-canonicalizer.ts";
import { enrichWithBibleParallels } from "../lib/bible-parallels.ts";
import { enrichWithEntities } from "../lib/entities.ts";
import { enrichWithUrantiaParallels } from "../lib/urantia-parallels.ts";
import { detectRefFormat } from "../types/node.ts";
import { paragraphFields } from "./paragraphs.ts";

export const mcpRoute = new Hono();

// Paragraph field selection for search results (includes rank/similarity)
const searchParagraphFields = {
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
} as const;

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

async function findParagraphByRef(db: ReturnType<typeof getDb>["db"], ref: string) {
	const format = detectRefFormat(ref);
	switch (format) {
		case "globalId":
			return db
				.select(paragraphFields)
				.from(paragraphs)
				.where(eq(paragraphs.globalId, ref))
				.limit(1);
		case "standardReferenceId":
			return db
				.select(paragraphFields)
				.from(paragraphs)
				.where(eq(paragraphs.standardReferenceId, ref))
				.limit(1);
		case "paperSectionParagraphId":
			return db
				.select(paragraphFields)
				.from(paragraphs)
				.where(eq(paragraphs.paperSectionParagraphId, ref))
				.limit(1);
		default:
			return [];
	}
}

// === Reusable Zod schemas for output validation ===

const entityTypeEnum = z.enum(["being", "place", "order", "race", "religion", "concept"]);

const paragraphEntityMentionSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: entityTypeEnum,
});

const bibleParallelSchema = z.object({
	chunkId: z.string(),
	reference: z.string(),
	bookCode: z.string(),
	chapter: z.number().int(),
	verseStart: z.number().int(),
	verseEnd: z.number().int(),
	text: z.string(),
	similarity: z.number(),
	rank: z.number().int(),
	source: z.string(),
	embeddingModel: z.string(),
});

const urantiaParallelSchema = z.object({
	id: z.string(),
	standardReferenceId: z.string(),
	paperId: z.string(),
	paperTitle: z.string(),
	sectionTitle: z.string().nullable(),
	text: z.string(),
	similarity: z.number(),
	rank: z.number().int(),
	source: z.string(),
	embeddingModel: z.string(),
});

const paragraphResultSchema = z.object({
	id: z.string(),
	standardReferenceId: z.string(),
	sortId: z.string(),
	paperId: z.string(),
	sectionId: z.string().nullable(),
	partId: z.string(),
	paperTitle: z.string(),
	sectionTitle: z.string().nullable(),
	paragraphId: z.string(),
	text: z.string(),
	htmlText: z.string(),
	labels: z.array(z.string()).nullable(),
	audio: z.any(),
	entities: z.array(paragraphEntityMentionSchema).optional(),
	bibleParallels: z.array(bibleParallelSchema).optional(),
	urantiaParallels: z.array(urantiaParallelSchema).optional(),
});

const bibleCanonEnum = z.enum(["ot", "deuterocanon", "nt"]);

const bibleVerseSchema = z.object({
	id: z.string(),
	reference: z.string(),
	bookCode: z.string(),
	bookName: z.string(),
	bookOrder: z.number().int(),
	canon: bibleCanonEnum,
	chapter: z.number().int(),
	verse: z.number().int(),
	text: z.string(),
	translation: z.string(),
});

const bibleBookSchema = z.object({
	bookCode: z.string(),
	bookName: z.string(),
	fullName: z.string(),
	abbr: z.string(),
	bookOrder: z.number().int(),
	canon: bibleCanonEnum,
	chapterCount: z.number().int(),
	verseCount: z.number().int(),
});

const searchResultSchema = paragraphResultSchema.extend({ rank: z.number() });
const semanticResultSchema = paragraphResultSchema.extend({ similarity: z.number() });

const entityResultSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: entityTypeEnum,
	aliases: z.array(z.string()).nullable(),
	description: z.string().nullable(),
	seeAlso: z.array(z.string()).nullable(),
	citationCount: z.number().int(),
});

const paginationMetaSchema = z.object({
	page: z.number().int(),
	limit: z.number().int(),
	total: z.number().int(),
	totalPages: z.number().int(),
});

// === Annotations ===

const READ_ONLY_LOCAL = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

const READ_ONLY_RANDOM = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
} as const;

const READ_ONLY_OPEN_WORLD = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

// Helper: format a tool result with both structured + text content for max client compatibility.
function structured<T>(data: T) {
	return {
		structuredContent: data as Record<string, unknown>,
		content: [{ type: "text" as const, text: JSON.stringify(data) }],
	};
}

// Apply paragraph enrichments (entities, Bible parallels, UB parallels) in
// the same order REST does (entities → bibleParallels → urantiaParallels)
// so structured output stays consistent across tools.
async function enrichParagraphs<T extends { id: string }>(
	db: ReturnType<typeof getDb>["db"],
	rows: T[],
	opts: {
		entities?: boolean;
		bibleParallels?: boolean;
		urantiaParallels?: boolean;
	},
) {
	let out: Array<Record<string, unknown>> = rows as unknown as Array<Record<string, unknown>>;
	if (opts.entities) out = (await enrichWithEntities(db, out as never)) as never;
	if (opts.bibleParallels) out = (await enrichWithBibleParallels(db, out as never)) as never;
	if (opts.urantiaParallels) out = (await enrichWithUrantiaParallels(db, out as never)) as never;
	return out as unknown as T[];
}

function errorResult(message: string) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
		isError: true,
	};
}

function createMcpServer() {
	const server = new McpServer({
		name: "Urantia Papers API",
		version: "1.0.0",
	});

	// 1. toc.get
	server.registerTool(
		"toc.get",
		{
			title: "Get Table of Contents",
			description:
				"Get the full table of contents of the Urantia Book. Returns all 4 parts and 197 papers with their titles. This is the best starting point to understand the book structure.",
			inputSchema: {},
			outputSchema: {
				parts: z.array(
					z.object({
						id: z.string(),
						title: z.string(),
						sponsorship: z.string().nullable(),
						papers: z.array(
							z.object({
								id: z.string(),
								title: z.string(),
								labels: z.array(z.string()).nullable(),
							}),
						),
					}),
				),
			},
			annotations: { title: "Get Table of Contents", ...READ_ONLY_LOCAL },
		},
		async () => {
			const { db } = getDb();
			const allParts = await db.select().from(parts).orderBy(parts.sortId);
			const allPapers = await db.select().from(papers).orderBy(papers.sortId);
			const tocParts = allParts.map((part) => ({
				id: part.id,
				title: part.title,
				sponsorship: part.sponsorship,
				papers: allPapers
					.filter((p) => p.partId === part.id)
					.map((p) => ({ id: p.id, title: p.title, labels: p.labels })),
			}));
			return structured({ parts: tocParts });
		},
	);

	// 2. papers.list
	server.registerTool(
		"papers.list",
		{
			title: "List Papers",
			description:
				"List all 197 papers in the Urantia Book with their metadata (id, title, partId, labels). Use toc.get for a hierarchical view instead.",
			inputSchema: {},
			outputSchema: {
				papers: z.array(
					z.object({
						id: z.string(),
						partId: z.string(),
						title: z.string(),
						sortId: z.string(),
						labels: z.array(z.string()).nullable(),
					}),
				),
			},
			annotations: { title: "List Papers", ...READ_ONLY_LOCAL },
		},
		async () => {
			const { db } = getDb();
			const allPapers = await db
				.select({
					id: papers.id,
					partId: papers.partId,
					title: papers.title,
					sortId: papers.sortId,
					labels: papers.labels,
				})
				.from(papers)
				.orderBy(papers.sortId);
			return structured({ papers: allPapers });
		},
	);

	// 3. papers.get
	server.registerTool(
		"papers.get",
		{
			title: "Get Paper",
			description:
				"Get a single paper with all its paragraphs. Paper IDs range from 0 (Foreword) to 196. Optionally include entity mentions.",
			inputSchema: {
				paper_id: z.string().describe("Paper ID (0-196). Example: '1'"),
				include_entities: z
					.boolean()
					.default(false)
					.describe("Include entity mentions in each paragraph"),
			},
			outputSchema: {
				paper: z.object({
					id: z.string(),
					partId: z.string(),
					title: z.string(),
					sortId: z.string(),
					labels: z.array(z.string()).nullable(),
				}),
				paragraphs: z.array(paragraphResultSchema),
			},
			annotations: { title: "Get Paper", ...READ_ONLY_LOCAL },
		},
		async ({ paper_id, include_entities }) => {
			const { db } = getDb();
			const paper = await db
				.select({
					id: papers.id,
					partId: papers.partId,
					title: papers.title,
					sortId: papers.sortId,
					labels: papers.labels,
				})
				.from(papers)
				.where(eq(papers.id, paper_id))
				.limit(1);

			if (paper.length === 0) return errorResult(`Paper ${paper_id} not found`);

			const paperParagraphs = await db
				.select(paragraphFields)
				.from(paragraphs)
				.where(eq(paragraphs.paperId, paper_id))
				.orderBy(paragraphs.sortId);

			const enrichedParagraphs = include_entities
				? await enrichWithEntities(db, paperParagraphs)
				: paperParagraphs;

			return structured({ paper: paper[0]!, paragraphs: enrichedParagraphs });
		},
	);

	// 4. papers.sections
	server.registerTool(
		"papers.sections",
		{
			title: "Get Paper Sections",
			description:
				"Get all sections within a paper, ordered by section number. Useful for understanding paper structure before reading specific sections.",
			inputSchema: {
				paper_id: z.string().describe("Paper ID (0-196). Example: '1'"),
			},
			outputSchema: {
				sections: z.array(
					z.object({
						id: z.string(),
						paperId: z.string(),
						sectionId: z.string(),
						title: z.string().nullable(),
						globalId: z.string(),
						sortId: z.string(),
					}),
				),
			},
			annotations: { title: "Get Paper Sections", ...READ_ONLY_LOCAL },
		},
		async ({ paper_id }) => {
			const { db } = getDb();
			const paper = await db.select().from(papers).where(eq(papers.id, paper_id)).limit(1);
			if (paper.length === 0) return errorResult(`Paper ${paper_id} not found`);

			const paperSections = await db
				.select()
				.from(sections)
				.where(eq(sections.paperId, paper_id))
				.orderBy(sections.sortId);

			return structured({ sections: paperSections });
		},
	);

	// 5. paragraphs.random
	server.registerTool(
		"paragraphs.random",
		{
			title: "Get Random Paragraph",
			description:
				"Get a random paragraph from the Urantia Book. Great for daily quotes, exploration, or discovering new passages.",
			inputSchema: {
				include_entities: z.boolean().default(false).describe("Include entity mentions"),
				include_bible_parallels: z
					.boolean()
					.default(false)
					.describe(
						"Include the top-10 Bible verses semantically nearest to this paragraph (UB → Bible direction). Pre-computed via text-embedding-3-large cosine similarity.",
					),
				include_urantia_parallels: z
					.boolean()
					.default(false)
					.describe(
						"Include the top-10 most-similar OTHER Urantia paragraphs ('see also'). Pre-computed via text-embedding-3-large cosine similarity.",
					),
			},
			outputSchema: { paragraph: paragraphResultSchema },
			annotations: { title: "Get Random Paragraph", ...READ_ONLY_RANDOM },
		},
		async ({ include_entities, include_bible_parallels, include_urantia_parallels }) => {
			const { db } = getDb();
			const result = await db
				.select(paragraphFields)
				.from(paragraphs)
				.orderBy(sql`RANDOM()`)
				.limit(1);
			if (result.length === 0) return errorResult("No paragraphs found");
			const enriched = await enrichParagraphs(db, result, {
				entities: include_entities,
				bibleParallels: include_bible_parallels,
				urantiaParallels: include_urantia_parallels,
			});
			return structured({ paragraph: enriched[0]! });
		},
	);

	// 6. paragraphs.get
	server.registerTool(
		"paragraphs.get",
		{
			title: "Get Paragraph",
			description:
				'Look up a specific paragraph by reference. Supports three formats: globalId ("1:2.0.1"), standardReferenceId ("2:0.1"), or paperSectionParagraphId ("2.0.1"). The format is auto-detected.',
			inputSchema: {
				ref: z
					.string()
					.describe('Paragraph reference in any format. Examples: "1:2.0.1", "2:0.1", "2.0.1"'),
				include_entities: z.boolean().default(false).describe("Include entity mentions"),
				include_bible_parallels: z
					.boolean()
					.default(false)
					.describe(
						"Include the top-10 Bible verses semantically nearest to this paragraph (UB → Bible direction).",
					),
				include_urantia_parallels: z
					.boolean()
					.default(false)
					.describe(
						"Include the top-10 most-similar OTHER Urantia paragraphs ('see also' across the corpus).",
					),
			},
			outputSchema: { paragraph: paragraphResultSchema },
			annotations: { title: "Get Paragraph", ...READ_ONLY_LOCAL },
		},
		async ({ ref, include_entities, include_bible_parallels, include_urantia_parallels }) => {
			const { db } = getDb();
			const format = detectRefFormat(ref);
			if (format === "unknown") {
				return errorResult(
					`Invalid reference format: "${ref}". Expected globalId (1:2.0.1), standardReferenceId (2:0.1), or paperSectionParagraphId (2.0.1)`,
				);
			}

			const result = await findParagraphByRef(db, ref);
			if (result.length === 0) return errorResult(`Paragraph "${ref}" not found`);

			const enriched = await enrichParagraphs(db, result, {
				entities: include_entities,
				bibleParallels: include_bible_parallels,
				urantiaParallels: include_urantia_parallels,
			});
			return structured({ paragraph: enriched[0]! });
		},
	);

	// 7. paragraphs.context
	server.registerTool(
		"paragraphs.context",
		{
			title: "Get Paragraph with Context",
			description:
				"Get a paragraph with surrounding context (N paragraphs before and after within the same paper). Useful for understanding passages in context.",
			inputSchema: {
				ref: z.string().describe('Paragraph reference. Examples: "1:2.0.1", "2:0.1", "2.0.1"'),
				window: z
					.number()
					.min(1)
					.max(10)
					.default(2)
					.describe("Number of paragraphs before and after (1-10, default 2)"),
				include_entities: z.boolean().default(false).describe("Include entity mentions"),
			},
			outputSchema: {
				target: paragraphResultSchema,
				before: z.array(paragraphResultSchema),
				after: z.array(paragraphResultSchema),
			},
			annotations: { title: "Get Paragraph with Context", ...READ_ONLY_LOCAL },
		},
		async ({ ref, window: windowSize, include_entities }) => {
			const { db } = getDb();
			const format = detectRefFormat(ref);
			if (format === "unknown") return errorResult(`Invalid reference format: "${ref}"`);

			const target = await findParagraphByRef(db, ref);
			if (target.length === 0) return errorResult(`Paragraph "${ref}" not found`);

			const targetParagraph = target[0]!;

			const before = await db
				.select(paragraphFields)
				.from(paragraphs)
				.where(
					and(
						eq(paragraphs.paperId, targetParagraph.paperId),
						lt(paragraphs.sortId, targetParagraph.sortId),
					),
				)
				.orderBy(sql`${paragraphs.sortId} DESC`)
				.limit(windowSize);

			const after = await db
				.select(paragraphFields)
				.from(paragraphs)
				.where(
					and(
						eq(paragraphs.paperId, targetParagraph.paperId),
						gt(paragraphs.sortId, targetParagraph.sortId),
					),
				)
				.orderBy(paragraphs.sortId)
				.limit(windowSize);

			if (include_entities) {
				const allParagraphs = [targetParagraph, ...before, ...after];
				const enriched = await enrichWithEntities(db, allParagraphs);
				const enrichedMap = new Map(enriched.map((p) => [p.id, p]));
				return structured({
					target: enrichedMap.get(targetParagraph.id)!,
					before: before.reverse().map((p) => enrichedMap.get(p.id)!),
					after: after.map((p) => enrichedMap.get(p.id)!),
				});
			}

			return structured({
				target: targetParagraph,
				before: before.reverse(),
				after,
			});
		},
	);

	// 8. search.fulltext
	server.registerTool(
		"search.fulltext",
		{
			title: "Full-Text Search",
			description:
				'Full-text search across all Urantia Book paragraphs. Supports three modes: "and" (all words must appear, default), "or" (any word), "phrase" (exact phrase). Results ranked by relevance.',
			inputSchema: {
				query: z.string().optional().describe('Search query. Example: "nature of God"'),
				q: z.string().optional().describe("Alias for `query` (REST compatibility)."),
				type: z
					.enum(["phrase", "and", "or"])
					.default("and")
					.describe("Search mode: phrase, and, or"),
				paper_id: z.string().optional().describe("Filter to a specific paper ID"),
				part_id: z.string().optional().describe("Filter to a specific part ID (1-4)"),
				page: z.number().int().min(0).default(0).describe("Page number (0-indexed)"),
				limit: z.number().int().min(1).max(100).default(20).describe("Results per page (1-100)"),
				include_entities: z.boolean().default(false).describe("Include entity mentions"),
				include_bible_parallels: z
					.boolean()
					.default(false)
					.describe(
						"Include the top-10 Bible verses semantically nearest to each result (UB → Bible).",
					),
				include_urantia_parallels: z
					.boolean()
					.default(false)
					.describe("Include the top-10 most-similar OTHER Urantia paragraphs for each result."),
			},
			outputSchema: {
				data: z.array(searchResultSchema),
				meta: paginationMetaSchema,
			},
			annotations: { title: "Full-Text Search", ...READ_ONLY_LOCAL },
		},
		async ({
			query,
			q,
			type,
			paper_id,
			part_id,
			page,
			limit,
			include_entities,
			include_bible_parallels,
			include_urantia_parallels,
		}) => {
			const searchQuery = query ?? q;
			if (!searchQuery) return errorResult("Either 'query' or 'q' is required");
			const { db } = getDb();
			const sanitized = searchQuery.replace(/[^\w\s]/g, " ").trim();
			if (!sanitized) return errorResult("Search query cannot be empty");

			const tsQuery = buildTsQuery(sanitized, type);
			const offset = page * limit;

			const conditions = [sql`search_vector @@ ${sql.raw(tsQuery)}`];
			if (paper_id) conditions.push(eq(paragraphs.paperId, paper_id));
			if (part_id) conditions.push(eq(paragraphs.partId, part_id));
			const whereClause = and(...conditions);

			const countResult = await db
				.select({ count: sql<number>`count(*)` })
				.from(paragraphs)
				.where(whereClause);
			const total = Number(countResult[0]?.count ?? 0);

			const results = await db
				.select({
					...searchParagraphFields,
					rank: sql<number>`ts_rank(search_vector, ${sql.raw(tsQuery)})`,
				})
				.from(paragraphs)
				.where(whereClause)
				.orderBy(sql`ts_rank(search_vector, ${sql.raw(tsQuery)}) DESC`)
				.limit(limit)
				.offset(offset);

			const enrichedResults = await enrichParagraphs(db, results, {
				entities: include_entities,
				bibleParallels: include_bible_parallels,
				urantiaParallels: include_urantia_parallels,
			});

			return structured({
				data: enrichedResults,
				meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
			});
		},
	);

	// 9. search.semantic
	server.registerTool(
		"search.semantic",
		{
			title: "Semantic Search",
			description:
				"Search the Urantia Book using semantic similarity (vector embeddings). Returns conceptually related results even without exact keyword matches. Requires OPENAI_API_KEY.",
			inputSchema: {
				query: z
					.string()
					.optional()
					.describe('Natural language query. Example: "What is the meaning of life?"'),
				q: z.string().optional().describe("Alias for `query` (REST compatibility)."),
				paper_id: z.string().optional().describe("Filter to a specific paper ID"),
				part_id: z.string().optional().describe("Filter to a specific part ID (1-4)"),
				page: z.number().int().min(0).default(0).describe("Page number (0-indexed)"),
				limit: z.number().int().min(1).max(100).default(20).describe("Results per page (1-100)"),
				include_entities: z.boolean().default(false).describe("Include entity mentions"),
				include_bible_parallels: z
					.boolean()
					.default(false)
					.describe(
						"Include the top-10 Bible verses semantically nearest to each result (UB → Bible).",
					),
				include_urantia_parallels: z
					.boolean()
					.default(false)
					.describe("Include the top-10 most-similar OTHER Urantia paragraphs for each result."),
			},
			outputSchema: {
				data: z.array(semanticResultSchema),
				meta: paginationMetaSchema,
			},
			annotations: { title: "Semantic Search", ...READ_ONLY_OPEN_WORLD },
		},
		async ({
			query,
			q,
			paper_id,
			part_id,
			page,
			limit,
			include_entities,
			include_bible_parallels,
			include_urantia_parallels,
		}) => {
			const searchQuery = query ?? q;
			if (!searchQuery) return errorResult("Either 'query' or 'q' is required");
			const { db } = getDb();
			const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
			const embeddingResponse = await openai.embeddings.create({
				model: "text-embedding-3-small",
				input: searchQuery,
			});
			const queryVector = embeddingResponse.data[0]?.embedding;
			if (!queryVector) return errorResult("Failed to generate embedding");
			const vectorStr = `[${queryVector.join(",")}]`;

			const offset = page * limit;
			const conditions = [sql`embedding IS NOT NULL`];
			if (paper_id) conditions.push(eq(paragraphs.paperId, paper_id));
			if (part_id) conditions.push(eq(paragraphs.partId, part_id));
			const whereClause = and(...conditions);

			const countResult = await db
				.select({ count: sql<number>`count(*)` })
				.from(paragraphs)
				.where(whereClause);
			const total = Number(countResult[0]?.count ?? 0);

			const results = await db
				.select({
					...searchParagraphFields,
					similarity: sql<number>`1 - (embedding <=> ${vectorStr}::vector)`,
				})
				.from(paragraphs)
				.where(whereClause)
				.orderBy(sql`embedding <=> ${vectorStr}::vector`)
				.limit(limit)
				.offset(offset);

			const enrichedResults = await enrichParagraphs(db, results, {
				entities: include_entities,
				bibleParallels: include_bible_parallels,
				urantiaParallels: include_urantia_parallels,
			});

			return structured({
				data: enrichedResults,
				meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
			});
		},
	);

	// 10. entities.list
	server.registerTool(
		"entities.list",
		{
			title: "List Entities",
			description:
				"Browse the entity catalog: beings, places, orders, races, religions, and concepts mentioned in the Urantia Book. Supports filtering by type and searching by name.",
			inputSchema: {
				type: entityTypeEnum.optional().describe("Filter by entity type"),
				query: z.string().optional().describe("Search entities by name or alias"),
				q: z.string().optional().describe("Alias for `query` (REST compatibility)."),
				page: z.number().int().min(0).default(0).describe("Page number (0-indexed)"),
				limit: z.number().int().min(1).max(100).default(20).describe("Results per page (1-100)"),
			},
			outputSchema: {
				data: z.array(entityResultSchema),
				meta: paginationMetaSchema,
			},
			annotations: { title: "List Entities", ...READ_ONLY_LOCAL },
		},
		async ({ type, query, q, page, limit }) => {
			const searchQuery = query ?? q;
			const { db } = getDb();
			const offset = page * limit;
			const conditions = [];
			if (type) conditions.push(eq(entities.type, type));
			if (searchQuery) {
				conditions.push(
					sql`(${ilike(entities.name, `%${searchQuery}%`)} OR array_to_string(${entities.aliases}, ',') ILIKE ${`%${searchQuery}%`})`,
				);
			}
			const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

			const countResult = await db
				.select({ count: sql<number>`count(*)` })
				.from(entities)
				.where(whereClause);
			const total = Number(countResult[0]?.count ?? 0);

			const results = await db
				.select({
					id: entities.id,
					name: entities.name,
					type: entities.type,
					aliases: entities.aliases,
					description: entities.description,
					seeAlso: entities.seeAlso,
					citationCount: entities.citationCount,
				})
				.from(entities)
				.where(whereClause)
				.orderBy(entities.name)
				.limit(limit)
				.offset(offset);

			return structured({
				data: results,
				meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
			});
		},
	);

	// 11. entities.get
	server.registerTool(
		"entities.get",
		{
			title: "Get Entity",
			description:
				"Get detailed information about a specific entity by its slug ID. Returns name, type, aliases, description, related entities, and citation count.",
			inputSchema: {
				entity_id: z.string().describe('Entity slug ID. Example: "god-the-father"'),
			},
			outputSchema: { entity: entityResultSchema },
			annotations: { title: "Get Entity", ...READ_ONLY_LOCAL },
		},
		async ({ entity_id }) => {
			const { db } = getDb();
			const result = await db
				.select({
					id: entities.id,
					name: entities.name,
					type: entities.type,
					aliases: entities.aliases,
					description: entities.description,
					seeAlso: entities.seeAlso,
					citationCount: entities.citationCount,
				})
				.from(entities)
				.where(eq(entities.id, entity_id))
				.limit(1);

			if (result.length === 0) return errorResult(`Entity "${entity_id}" not found`);
			return structured({ entity: result[0]! });
		},
	);

	// 12. entities.paragraphs
	server.registerTool(
		"entities.paragraphs",
		{
			title: "Get Entity Paragraphs",
			description:
				"Get all paragraphs that mention a specific entity, ordered by position in the text. Useful for studying everything said about a particular being, place, or concept.",
			inputSchema: {
				entity_id: z.string().describe('Entity slug ID. Example: "god-the-father"'),
				page: z.number().int().min(0).default(0).describe("Page number (0-indexed)"),
				limit: z.number().int().min(1).max(100).default(20).describe("Results per page (1-100)"),
			},
			outputSchema: {
				data: z.array(paragraphResultSchema),
				meta: paginationMetaSchema,
			},
			annotations: { title: "Get Entity Paragraphs", ...READ_ONLY_LOCAL },
		},
		async ({ entity_id, page, limit }) => {
			const { db } = getDb();
			const entity = await db
				.select({ id: entities.id })
				.from(entities)
				.where(eq(entities.id, entity_id))
				.limit(1);
			if (entity.length === 0) return errorResult(`Entity "${entity_id}" not found`);

			const offset = page * limit;
			const countResult = await db
				.select({ count: sql<number>`count(*)` })
				.from(paragraphEntities)
				.where(eq(paragraphEntities.entityId, entity_id));
			const total = Number(countResult[0]?.count ?? 0);

			const results = await db
				.select(paragraphFields)
				.from(paragraphs)
				.innerJoin(paragraphEntities, eq(paragraphs.id, paragraphEntities.paragraphId))
				.where(eq(paragraphEntities.entityId, entity_id))
				.orderBy(paragraphs.sortId)
				.limit(limit)
				.offset(offset);

			return structured({
				data: results,
				meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
			});
		},
	);

	// 13. audio.get
	server.registerTool(
		"audio.get",
		{
			title: "Get Paragraph Audio",
			description:
				'Get the audio file URL for a specific paragraph. Accepts any paragraph reference format (globalId "1:2.0.1", standardReferenceId "2:0.1", or paperSectionParagraphId "2.0.1").',
			inputSchema: {
				paragraph_ref: z.string().describe('Paragraph reference. Example: "2:0.1"'),
			},
			outputSchema: {
				paragraphId: z.string(),
				audio: z.any(),
			},
			annotations: { title: "Get Paragraph Audio", ...READ_ONLY_LOCAL },
		},
		async ({ paragraph_ref }) => {
			const { db } = getDb();
			const format = detectRefFormat(paragraph_ref);
			const col =
				format === "globalId"
					? paragraphs.globalId
					: format === "standardReferenceId"
						? paragraphs.standardReferenceId
						: format === "paperSectionParagraphId"
							? paragraphs.paperSectionParagraphId
							: null;

			if (!col) return errorResult(`Invalid paragraph reference: "${paragraph_ref}"`);

			const result = await db
				.select({ globalId: paragraphs.globalId, audio: paragraphs.audio })
				.from(paragraphs)
				.where(eq(col, paragraph_ref))
				.limit(1);

			if (result.length === 0) return errorResult(`Paragraph "${paragraph_ref}" not found`);

			const row = result[0]!;
			return structured({ paragraphId: row.globalId, audio: row.audio ?? null });
		},
	);

	// 14. bible.books — list all 81 Bible books
	server.registerTool(
		"bible.books",
		{
			title: "List Bible Books",
			description:
				"List all 81 books of the World English Bible (eng-web): 39 Old Testament + 15 deuterocanonical + 27 New Testament. Each entry includes OSIS book code, full name, abbreviation, canonical order, canon, and chapter/verse counts.",
			inputSchema: {},
			outputSchema: { books: z.array(bibleBookSchema) },
			annotations: { title: "List Bible Books", ...READ_ONLY_LOCAL },
		},
		async () => {
			const { db } = getDb();
			const rows = await db
				.select({
					bookCode: bibleVerses.bookCode,
					chapterCount: sql<number>`count(distinct ${bibleVerses.chapter})`,
					verseCount: sql<number>`count(*)::int`,
				})
				.from(bibleVerses)
				.groupBy(bibleVerses.bookCode);
			const counts = new Map(rows.map((r) => [r.bookCode, r]));
			const books = BIBLE_BOOKS.map((b) => {
				const c = counts.get(b.osis);
				return {
					bookCode: b.osis,
					bookName: b.name,
					fullName: b.fullName,
					abbr: b.abbr,
					bookOrder: b.order,
					canon: b.canon,
					chapterCount: Number(c?.chapterCount ?? 0),
					verseCount: Number(c?.verseCount ?? 0),
				};
			});
			return structured({ books });
		},
	);

	// 15. bible.book — get a single book's metadata
	server.registerTool(
		"bible.book",
		{
			title: "Get Bible Book",
			description:
				'Get metadata for a single Bible book including chapter and verse counts. Accepts OSIS codes ("Gen"), USFM codes ("GEN"), full names ("Genesis"), and aliases ("genesis", "1-maccabees") — case-insensitive, hyphens/underscores tolerated.',
			inputSchema: {
				book_code: z
					.string()
					.describe('Book identifier. Examples: "Gen", "GEN", "Genesis", "1Macc", "DanGr"'),
			},
			outputSchema: { book: bibleBookSchema },
			annotations: { title: "Get Bible Book", ...READ_ONLY_LOCAL },
		},
		async ({ book_code }) => {
			const meta = resolveBibleBook(book_code);
			if (!meta) return errorResult(`Bible book "${book_code}" not found`);

			const { db } = getDb();
			const counts = await db
				.select({
					chapterCount: sql<number>`count(distinct ${bibleVerses.chapter})`,
					verseCount: sql<number>`count(*)::int`,
				})
				.from(bibleVerses)
				.where(eq(bibleVerses.bookCode, meta.osis));

			return structured({
				book: {
					bookCode: meta.osis,
					bookName: meta.name,
					fullName: meta.fullName,
					abbr: meta.abbr,
					bookOrder: meta.order,
					canon: meta.canon,
					chapterCount: Number(counts[0]?.chapterCount ?? 0),
					verseCount: Number(counts[0]?.verseCount ?? 0),
				},
			});
		},
	);

	// 16. bible.chapter — get all verses in a chapter
	server.registerTool(
		"bible.chapter",
		{
			title: "Get Bible Chapter",
			description:
				"Get every verse in a Bible chapter, ordered by verse number. Accepts OSIS, USFM, full name, or alias for `book_code`.",
			inputSchema: {
				book_code: z.string().describe('Book identifier. Example: "Gen" or "Genesis"'),
				chapter: z.number().int().min(1).describe("Chapter number (1-indexed)"),
			},
			outputSchema: {
				bookCode: z.string(),
				bookName: z.string(),
				canon: bibleCanonEnum,
				chapter: z.number().int(),
				verses: z.array(bibleVerseSchema),
			},
			annotations: { title: "Get Bible Chapter", ...READ_ONLY_LOCAL },
		},
		async ({ book_code, chapter }) => {
			const meta = resolveBibleBook(book_code);
			if (!meta) return errorResult(`Bible book "${book_code}" not found`);

			const { db } = getDb();
			const rows = await db
				.select()
				.from(bibleVerses)
				.where(and(eq(bibleVerses.bookCode, meta.osis), eq(bibleVerses.chapter, chapter)))
				.orderBy(bibleVerses.verse);

			if (rows.length === 0) {
				return errorResult(`${meta.name} has no chapter ${chapter}`);
			}

			const verses = rows.map((r) => ({
				id: r.id,
				reference:
					formatBibleReference(r.bookCode, r.chapter, r.verse) ??
					`${r.bookName} ${r.chapter}:${r.verse}`,
				bookCode: r.bookCode,
				bookName: r.bookName,
				bookOrder: r.bookOrder,
				canon: r.canon as "ot" | "deuterocanon" | "nt",
				chapter: r.chapter,
				verse: r.verse,
				text: r.text,
				translation: r.translation,
			}));

			return structured({
				bookCode: meta.osis,
				bookName: meta.name,
				canon: meta.canon,
				chapter,
				verses,
			});
		},
	);

	// 17. bible.verse — get a single verse
	server.registerTool(
		"bible.verse",
		{
			title: "Get Bible Verse",
			description:
				"Get a single verse from the World English Bible (eng-web). Accepts OSIS, USFM, full name, or alias for `book_code`.",
			inputSchema: {
				book_code: z.string().describe('Book identifier. Example: "John" or "Joh"'),
				chapter: z.number().int().min(1).describe("Chapter number"),
				verse: z.number().int().min(1).describe("Verse number"),
			},
			outputSchema: { verse: bibleVerseSchema },
			annotations: { title: "Get Bible Verse", ...READ_ONLY_LOCAL },
		},
		async ({ book_code, chapter, verse }) => {
			const meta = resolveBibleBook(book_code);
			if (!meta) return errorResult(`Bible book "${book_code}" not found`);

			const { db } = getDb();
			const rows = await db
				.select()
				.from(bibleVerses)
				.where(
					and(
						eq(bibleVerses.bookCode, meta.osis),
						eq(bibleVerses.chapter, chapter),
						eq(bibleVerses.verse, verse),
					),
				)
				.limit(1);

			const row = rows[0];
			if (!row) return errorResult(`${meta.name} ${chapter}:${verse} not found`);

			return structured({
				verse: {
					id: row.id,
					reference:
						formatBibleReference(row.bookCode, row.chapter, row.verse) ??
						`${row.bookName} ${row.chapter}:${row.verse}`,
					bookCode: row.bookCode,
					bookName: row.bookName,
					bookOrder: row.bookOrder,
					canon: row.canon as "ot" | "deuterocanon" | "nt",
					chapter: row.chapter,
					verse: row.verse,
					text: row.text,
					translation: row.translation,
				},
			});
		},
	);

	// 18. bible.verse.urantia_parallels — top-10 UB paragraphs for a Bible verse
	server.registerTool(
		"bible.verse.urantia_parallels",
		{
			title: "Get Urantia Parallels for a Bible Verse",
			description:
				"Returns the top 10 Urantia paragraphs whose embeddings are nearest to the Bible chunk that contains this verse — the reverse of `include_bible_parallels` on the UB side. Pre-computed at seed time with text-embedding-3-large (3072-d) cosine similarity. Each result carries a similarity score (0..1) and rank (1..10).\n\nThese are *semantic* parallels, not curated. Treat results as starting points for further reading, not as authoritative parallels.",
			inputSchema: {
				book_code: z.string().describe('Book identifier. Example: "Matt"'),
				chapter: z.number().int().min(1).describe("Chapter number"),
				verse: z.number().int().min(1).describe("Verse number"),
			},
			outputSchema: {
				verse: bibleVerseSchema,
				chunk: z.object({
					id: z.string(),
					reference: z.string(),
					verseStart: z.number().int(),
					verseEnd: z.number().int(),
					text: z.string(),
				}),
				urantiaParallels: z.array(urantiaParallelSchema),
			},
			annotations: { title: "Get Urantia Parallels for a Bible Verse", ...READ_ONLY_LOCAL },
		},
		async ({ book_code, chapter, verse }) => {
			const meta = resolveBibleBook(book_code);
			if (!meta) return errorResult(`Bible book "${book_code}" not found`);

			const { db } = getDb();
			const verseRows = await db
				.select({
					verseId: bibleVerses.id,
					bookCode: bibleVerses.bookCode,
					bookName: bibleVerses.bookName,
					bookOrder: bibleVerses.bookOrder,
					canon: bibleVerses.canon,
					chapter: bibleVerses.chapter,
					verse: bibleVerses.verse,
					text: bibleVerses.text,
					translation: bibleVerses.translation,
					chunkId: bibleVerses.chunkId,
				})
				.from(bibleVerses)
				.where(
					and(
						eq(bibleVerses.bookCode, meta.osis),
						eq(bibleVerses.chapter, chapter),
						eq(bibleVerses.verse, verse),
					),
				)
				.limit(1);

			const v = verseRows[0];
			if (!v) return errorResult(`${meta.name} ${chapter}:${verse} not found`);
			if (!v.chunkId) {
				return errorResult(`${meta.name} ${chapter}:${verse} has no embedding chunk yet`);
			}

			const chunkRows = await db
				.select({
					id: bibleChunks.id,
					verseStart: bibleChunks.verseStart,
					verseEnd: bibleChunks.verseEnd,
					text: bibleChunks.text,
				})
				.from(bibleChunks)
				.where(eq(bibleChunks.id, v.chunkId))
				.limit(1);
			const chunk = chunkRows[0];
			if (!chunk) return errorResult(`Chunk ${v.chunkId} not found`);

			const startRef =
				formatBibleReference(v.bookCode, v.chapter, chunk.verseStart) ??
				`${v.bookName} ${v.chapter}:${chunk.verseStart}`;
			const chunkReference =
				chunk.verseEnd === chunk.verseStart ? startRef : `${startRef}-${chunk.verseEnd}`;

			const top = await db
				.select({
					similarity: bibleParallels.similarity,
					rank: bibleParallels.rank,
					source: bibleParallels.source,
					embeddingModel: bibleParallels.embeddingModel,
					pId: paragraphs.id,
					standardReferenceId: paragraphs.standardReferenceId,
					paperId: paragraphs.paperId,
					paperTitle: paragraphs.paperTitle,
					sectionTitle: paragraphs.sectionTitle,
					text: paragraphs.text,
				})
				.from(bibleParallels)
				.innerJoin(paragraphs, eq(bibleParallels.paragraphId, paragraphs.id))
				.where(
					and(
						eq(bibleParallels.bibleChunkId, v.chunkId),
						eq(bibleParallels.direction, "bible_to_ub"),
					),
				)
				.orderBy(asc(bibleParallels.rank));

			return structured({
				verse: {
					id: v.verseId,
					reference:
						formatBibleReference(v.bookCode, v.chapter, v.verse) ??
						`${v.bookName} ${v.chapter}:${v.verse}`,
					bookCode: v.bookCode,
					bookName: v.bookName,
					bookOrder: v.bookOrder,
					canon: v.canon as "ot" | "deuterocanon" | "nt",
					chapter: v.chapter,
					verse: v.verse,
					text: v.text,
					translation: v.translation,
				},
				chunk: {
					id: chunk.id,
					reference: chunkReference,
					verseStart: chunk.verseStart,
					verseEnd: chunk.verseEnd,
					text: chunk.text,
				},
				urantiaParallels: top.map((p) => ({
					id: p.pId,
					standardReferenceId: p.standardReferenceId,
					paperId: p.paperId,
					paperTitle: p.paperTitle,
					sectionTitle: p.sectionTitle,
					text: p.text,
					similarity: p.similarity,
					rank: p.rank,
					source: p.source,
					embeddingModel: p.embeddingModel,
				})),
			});
		},
	);

	// 19. bible.search.semantic — semantic search across Bible w/ UB paragraphs attached
	server.registerTool(
		"bible.search.semantic",
		{
			title: "Bible Semantic Search",
			description:
				"Free-form natural-language search across all Bible chunks, ranked by cosine similarity. Each result includes the top-N pre-computed Urantia paragraphs related to that chunk via `bible_parallels` (direction=bible_to_ub). One query surfaces both Bible matches and the relevant UB content. Optional filters: `canon` (`ot`, `deuterocanon`, `nt`) and `book_code`. Set `urantia_parallel_limit` to 0 to suppress the UB attachment. Requires OPENAI_API_KEY.",
			inputSchema: {
				query: z
					.string()
					.optional()
					.describe('Natural language query. Example: "blessed are the poor"'),
				q: z.string().optional().describe("Alias for `query` (REST compatibility)."),
				canon: bibleCanonEnum.optional().describe("Filter by canon: ot, deuterocanon, nt"),
				book_code: z
					.string()
					.optional()
					.describe('Restrict to a single book. Example: "Matt" or "Matthew"'),
				page: z.number().int().min(0).default(0).describe("Page number (0-indexed)"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.default(20)
					.describe("Bible results per page (1-100)"),
				urantia_parallel_limit: z
					.number()
					.int()
					.min(0)
					.max(10)
					.default(3)
					.describe(
						"How many UB paragraphs to attach per Bible result (0-10, default 3). 0 disables.",
					),
			},
			outputSchema: {
				data: z.array(
					z.object({
						id: z.string(),
						reference: z.string(),
						bookCode: z.string(),
						bookName: z.string(),
						canon: bibleCanonEnum,
						chapter: z.number().int(),
						verseStart: z.number().int(),
						verseEnd: z.number().int(),
						text: z.string(),
						similarity: z.number(),
						urantiaParallels: z.array(
							z.object({
								id: z.string(),
								standardReferenceId: z.string(),
								paperId: z.string(),
								paperTitle: z.string(),
								sectionTitle: z.string().nullable(),
								text: z.string(),
								similarity: z.number(),
								rank: z.number().int(),
							}),
						),
					}),
				),
				meta: paginationMetaSchema,
			},
			annotations: { title: "Bible Semantic Search", ...READ_ONLY_OPEN_WORLD },
		},
		async ({ query, q, canon, book_code, page, limit, urantia_parallel_limit }) => {
			const searchQuery = query ?? q;
			if (!searchQuery) return errorResult("Either 'query' or 'q' is required");

			let resolvedBookCode: string | undefined;
			if (book_code) {
				const meta = resolveBibleBook(book_code);
				if (!meta) return errorResult(`Bible book "${book_code}" not found`);
				resolvedBookCode = meta.osis;
			}

			const { db } = getDb();
			const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
			const embeddingResponse = await openai.embeddings.create({
				model: "text-embedding-3-small",
				input: searchQuery,
			});
			const queryVector = embeddingResponse.data[0]?.embedding;
			if (!queryVector) return errorResult("Failed to generate embedding");
			const vectorStr = `[${queryVector.join(",")}]`;
			const offset = page * limit;

			const filteredChunks = sql`
				SELECT bc.id, bc.book_code, bc.chapter, bc.verse_start, bc.verse_end,
				       bc.text, bc.embedding_small,
				       (SELECT canon FROM bible_verses WHERE chunk_id = bc.id LIMIT 1) AS canon
				FROM bible_chunks bc
				WHERE bc.embedding_small IS NOT NULL
				${canon ? sql`AND EXISTS (SELECT 1 FROM bible_verses WHERE chunk_id = bc.id AND canon = ${canon})` : sql``}
				${resolvedBookCode ? sql`AND bc.book_code = ${resolvedBookCode}` : sql``}
			`;

			const countPromise = db.execute(sql<{ n: number }[]>`
				SELECT COUNT(*)::int AS n FROM (${filteredChunks}) f
			`);
			const resultsPromise = db.execute(sql<
				{
					id: string;
					book_code: string;
					chapter: number;
					verse_start: number;
					verse_end: number;
					text: string;
					canon: string;
					similarity: number;
				}[]
			>`
				SELECT f.id, f.book_code, f.chapter, f.verse_start, f.verse_end, f.text, f.canon,
				       (1 - (f.embedding_small <=> ${vectorStr}::vector))::real AS similarity
				FROM (${filteredChunks}) f
				ORDER BY f.embedding_small <=> ${vectorStr}::vector ASC
				LIMIT ${limit} OFFSET ${offset}
			`);

			const [countRows, resultRows] = await Promise.all([countPromise, resultsPromise]);
			const total = Number((countRows as unknown as { n: number }[])[0]?.n ?? 0);
			const chunks = resultRows as unknown as {
				id: string;
				book_code: string;
				chapter: number;
				verse_start: number;
				verse_end: number;
				text: string;
				canon: string;
				similarity: number;
			}[];

			const paragraphsByChunk = new Map<
				string,
				{
					id: string;
					standardReferenceId: string;
					paperId: string;
					paperTitle: string;
					sectionTitle: string | null;
					text: string;
					similarity: number;
					rank: number;
				}[]
			>();

			if (chunks.length > 0 && urantia_parallel_limit > 0) {
				const chunkIds = chunks.map((c) => c.id);
				const paragraphRows = await db
					.select({
						chunkId: bibleParallels.bibleChunkId,
						rank: bibleParallels.rank,
						similarity: bibleParallels.similarity,
						id: paragraphs.id,
						standardReferenceId: paragraphs.standardReferenceId,
						paperId: paragraphs.paperId,
						paperTitle: paragraphs.paperTitle,
						sectionTitle: paragraphs.sectionTitle,
						text: paragraphs.text,
					})
					.from(bibleParallels)
					.innerJoin(paragraphs, eq(bibleParallels.paragraphId, paragraphs.id))
					.where(
						and(
							eq(bibleParallels.direction, "bible_to_ub"),
							inArray(bibleParallels.bibleChunkId, chunkIds),
						),
					)
					.orderBy(asc(bibleParallels.bibleChunkId), asc(bibleParallels.rank));

				for (const row of paragraphRows) {
					const list = paragraphsByChunk.get(row.chunkId) ?? [];
					if (list.length < urantia_parallel_limit) {
						list.push({
							id: row.id,
							standardReferenceId: row.standardReferenceId,
							paperId: row.paperId,
							paperTitle: row.paperTitle,
							sectionTitle: row.sectionTitle,
							text: row.text,
							similarity: row.similarity,
							rank: row.rank,
						});
					}
					paragraphsByChunk.set(row.chunkId, list);
				}
			}

			const data = chunks.map((c) => {
				const meta = resolveBibleBook(c.book_code);
				const startRef =
					formatBibleReference(c.book_code, c.chapter, c.verse_start) ??
					`${meta?.name ?? c.book_code} ${c.chapter}:${c.verse_start}`;
				const fullRef = c.verse_end === c.verse_start ? startRef : `${startRef}-${c.verse_end}`;
				return {
					id: c.id,
					reference: fullRef,
					bookCode: c.book_code,
					bookName: meta?.name ?? c.book_code,
					canon: c.canon as "ot" | "deuterocanon" | "nt",
					chapter: c.chapter,
					verseStart: c.verse_start,
					verseEnd: c.verse_end,
					text: c.text,
					similarity: c.similarity,
					urantiaParallels: paragraphsByChunk.get(c.id) ?? [],
				};
			});

			return structured({
				data,
				meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
			});
		},
	);

	// --- Resources ---

	// urantia://paper/{id} — full paper as plaintext markdown
	server.resource(
		"paper",
		new ResourceTemplate("urantia://paper/{id}", {
			list: async () => {
				const { db } = getDb();
				const all = await db
					.select({ id: papers.id, title: papers.title })
					.from(papers)
					.orderBy(papers.sortId);
				return {
					resources: all.map((p) => ({
						uri: `urantia://paper/${p.id}`,
						name: `Paper ${p.id}: ${p.title}`,
						mimeType: "text/markdown",
					})),
				};
			},
		}),
		{
			description:
				"A single paper from the Urantia Book (0-196), rendered as plaintext markdown with section headings and paragraph references. Useful for full-paper context in RAG or summarization.",
			mimeType: "text/markdown",
		},
		async (uri, { id }) => {
			const paperId = String(id);
			const { db } = getDb();
			const paper = await db
				.select({ id: papers.id, title: papers.title, partId: papers.partId })
				.from(papers)
				.where(eq(papers.id, paperId))
				.limit(1);

			if (paper.length === 0) {
				throw new Error(`Paper ${paperId} not found`);
			}

			const paperParagraphs = await db
				.select({
					sortId: paragraphs.sortId,
					sectionTitle: paragraphs.sectionTitle,
					standardReferenceId: paragraphs.standardReferenceId,
					text: paragraphs.text,
				})
				.from(paragraphs)
				.where(eq(paragraphs.paperId, paperId))
				.orderBy(paragraphs.sortId);

			const lines: string[] = [`# Paper ${paperId}: ${paper[0]!.title}`, ""];
			let currentSection: string | null | undefined;
			for (const p of paperParagraphs) {
				if (p.sectionTitle !== currentSection) {
					currentSection = p.sectionTitle;
					if (currentSection) {
						lines.push("", `## ${currentSection}`, "");
					}
				}
				lines.push(`[${p.standardReferenceId}] ${p.text}`, "");
			}

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/markdown",
						text: lines.join("\n"),
					},
				],
			};
		},
	);

	// urantia://entity/{id} — entity description + paragraph refs that mention it
	server.resource(
		"entity",
		new ResourceTemplate("urantia://entity/{id}", {
			list: async () => {
				const { db } = getDb();
				const all = await db
					.select({ id: entities.id, name: entities.name })
					.from(entities)
					.orderBy(entities.name)
					.limit(500);
				return {
					resources: all.map((e) => ({
						uri: `urantia://entity/${e.id}`,
						name: e.name,
						mimeType: "text/markdown",
					})),
				};
			},
		}),
		{
			description:
				"An entity (being, place, order, race, religion, or concept) from the Urantia Book with description, aliases, related entities, and references to all paragraphs that mention it.",
			mimeType: "text/markdown",
		},
		async (uri, { id }) => {
			const entityId = String(id);
			const { db } = getDb();
			const entity = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);

			if (entity.length === 0) {
				throw new Error(`Entity "${entityId}" not found`);
			}

			const e = entity[0]!;
			const refs = await db
				.select({ standardReferenceId: paragraphs.standardReferenceId })
				.from(paragraphs)
				.innerJoin(paragraphEntities, eq(paragraphs.id, paragraphEntities.paragraphId))
				.where(eq(paragraphEntities.entityId, entityId))
				.orderBy(paragraphs.sortId);

			const lines: string[] = [`# ${e.name}`, "", `**Type:** ${e.type}`];
			if (e.aliases && e.aliases.length > 0) {
				lines.push(`**Aliases:** ${e.aliases.join(", ")}`);
			}
			lines.push("");
			if (e.description) {
				lines.push(e.description, "");
			}
			if (e.seeAlso && e.seeAlso.length > 0) {
				lines.push(`**See also:** ${e.seeAlso.join(", ")}`, "");
			}
			lines.push(
				`## References (${refs.length})`,
				"",
				...refs.map((r) => `- ${r.standardReferenceId}`),
			);

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/markdown",
						text: lines.join("\n"),
					},
				],
			};
		},
	);

	// --- Prompts ---

	server.prompt(
		"study_assistant",
		"Prime the model to act as a Urantia Book study assistant. Optionally focus on a specific topic.",
		{
			topic: z
				.string()
				.optional()
				.describe('Optional topic or passage to focus on. Example: "the nature of God"'),
		},
		({ topic }) => {
			const focus = topic
				? `\n\nThe student wants to explore: **${topic}**. Begin by surfacing 2-3 of the most relevant Urantia Book passages on this topic via the search.fulltext or search.semantic tools, then offer a thoughtful entry point for discussion.`
				: "";
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: `You are a study assistant for the Urantia Book — a 2,097-page revelation in 196 papers covering cosmology, theology, philosophy, and the life and teachings of Jesus. Help the user study by:

- Citing exact paragraph references (e.g. "Paper 1:2.3") when quoting
- Using the search.fulltext and search.semantic tools to find relevant passages
- Following passages back to their full context with paragraphs.context
- Surfacing entity relationships via entities.list and entities.paragraphs
- Reading entire papers via the urantia://paper/{id} resource when needed

Stay grounded in the text. When the user asks something not addressed in the Urantia Book, say so clearly rather than improvising.${focus}`,
						},
					},
				],
			};
		},
	);

	server.prompt(
		"comparative_theology",
		"Prime the model to compare a Urantia Book teaching with another religious or philosophical tradition.",
		{
			topic: z.string().describe('The teaching or concept to compare. Example: "the soul"'),
			tradition: z
				.string()
				.describe('The other tradition. Example: "Buddhism", "Christian mysticism", "Stoicism"'),
		},
		({ topic, tradition }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Compare what the Urantia Book teaches about **${topic}** with the corresponding teaching in **${tradition}**.

Approach:
1. Use search.semantic to gather Urantia passages on ${topic} (start broad, then narrow)
2. State the Urantia view in 3-5 bullet points with paragraph citations
3. State the ${tradition} view in 3-5 bullet points (you may rely on general knowledge here)
4. Identify points of resonance and points of divergence
5. Be honest about uncertainty; don't force a synthesis

Cite Urantia passages by their standard reference (e.g. "Paper 112:7.1"). For ${tradition}, cite source texts where possible.`,
					},
				},
			],
		}),
	);

	return server;
}

// OAuth/OIDC metadata discovery — return JSON 404 so MCP clients know no auth is needed
mcpRoute.get("/.well-known/*", (c) =>
	c.json({ error: "This server requires no authentication." }, 404),
);

// Discovery response for browser/GET requests without SSE accept header
mcpRoute.get("/", async (c) => {
	if (c.req.header("Accept")?.includes("text/event-stream")) {
		// Proper MCP SSE request — let the transport handle it
		const server = createMcpServer();
		const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
		await server.connect(transport);
		return transport.handleRequest(c);
	}

	// Browser or curl — return a friendly discovery response
	return c.json({
		server: {
			name: "Urantia Papers API",
			version: "1.0.0",
			transport: "streamable-http",
			docs: "https://urantia.dev/mcp",
		},
		capabilities: {
			tools: {
				"toc.get": { description: "Get the full table of contents — all 4 parts and 197 papers" },
				"papers.list": { description: "List all 197 papers with metadata" },
				"papers.get": {
					description: "Get a single paper with all its paragraphs",
					params: ["paper_id", "include_entities"],
				},
				"papers.sections": {
					description: "Get all sections within a paper",
					params: ["paper_id"],
				},
				"paragraphs.random": {
					description: "Get a random paragraph",
					params: ["include_entities", "include_bible_parallels", "include_urantia_parallels"],
				},
				"paragraphs.get": {
					description: "Look up a paragraph by reference (3 formats auto-detected)",
					params: [
						"ref",
						"include_entities",
						"include_bible_parallels",
						"include_urantia_parallels",
					],
				},
				"paragraphs.context": {
					description: "Get a paragraph with surrounding context",
					params: ["ref", "window", "include_entities"],
				},
				"search.fulltext": {
					description: "Full-text search (and/or/phrase modes)",
					params: [
						"q",
						"type",
						"paper_id",
						"part_id",
						"page",
						"limit",
						"include_entities",
						"include_bible_parallels",
						"include_urantia_parallels",
					],
				},
				"search.semantic": {
					description: "Semantic similarity search via vector embeddings",
					params: [
						"q",
						"paper_id",
						"part_id",
						"page",
						"limit",
						"include_entities",
						"include_bible_parallels",
						"include_urantia_parallels",
					],
				},
				"entities.list": {
					description:
						"Browse 4,400+ entities (beings, places, orders, races, religions, concepts)",
					params: ["type", "q", "page", "limit"],
				},
				"entities.get": {
					description: "Get entity details by slug ID",
					params: ["entity_id"],
				},
				"entities.paragraphs": {
					description: "Get all paragraphs mentioning an entity",
					params: ["entity_id", "page", "limit"],
				},
				"audio.get": {
					description: "Get audio file URLs for a paragraph",
					params: ["paragraph_ref"],
				},
				"bible.books": {
					description: "List all 81 Bible books (39 OT + 15 deuterocanon + 27 NT)",
				},
				"bible.book": {
					description: "Get a Bible book's metadata (chapters, verses, canon)",
					params: ["book_code"],
				},
				"bible.chapter": {
					description: "Get every verse in a Bible chapter",
					params: ["book_code", "chapter"],
				},
				"bible.verse": {
					description: "Get a single Bible verse",
					params: ["book_code", "chapter", "verse"],
				},
				"bible.verse.urantia_parallels": {
					description:
						"Top-10 Urantia paragraphs semantically nearest to a Bible verse's chunk (Bible → UB)",
					params: ["book_code", "chapter", "verse"],
				},
				"bible.search.semantic": {
					description:
						"Semantic search across the Bible. Each result includes top-N pre-computed UB paragraphs.",
					params: ["q", "canon", "book_code", "page", "limit", "urantia_parallel_limit"],
				},
			},
			resources: {
				"urantia://paper/{id}": {
					description:
						"Full paper rendered as plaintext markdown with section headings and paragraph references",
				},
				"urantia://entity/{id}": {
					description: "Entity description with aliases, see-also, and all paragraph references",
				},
			},
			prompts: {
				study_assistant: {
					description: "Prime the model as a Urantia Book study assistant",
					args: ["topic"],
				},
				comparative_theology: {
					description: "Compare a Urantia teaching with another tradition",
					args: ["topic", "tradition"],
				},
			},
		},
		usage: {
			config: {
				mcpServers: {
					"urantia-papers": {
						url: "https://api.urantia.dev/mcp",
					},
				},
			},
			compatible_with: ["Claude Desktop", "Claude Code", "Cursor", "Windsurf"],
		},
	});
});

// POST/DELETE — MCP Streamable HTTP transport
mcpRoute.post("/", async (c) => {
	const server = createMcpServer();
	const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
	await server.connect(transport);
	return transport.handleRequest(c);
});

mcpRoute.delete("/", async (c) => {
	const server = createMcpServer();
	const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
	await server.connect(transport);
	return transport.handleRequest(c);
});
