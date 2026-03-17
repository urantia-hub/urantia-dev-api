import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { enrichWithEntities, wantsEntities } from "../lib/entities.ts";
import { detectRefFormat } from "../types/node.ts";
import {
	ContextQuery,
	ErrorResponse,
	IncludeQuery,
	ParagraphContextResponse,
	ParagraphRefParam,
	ParagraphResponse,
} from "../validators/schemas.ts";

export const paragraphsRoute = new OpenAPIHono();

// Helper to select paragraph fields (excludes searchVector and embedding)
export const paragraphFields = {
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

// Helper to find a paragraph by any reference format
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

// GET /paragraphs/random — random paragraph
const getRandomRoute = createRoute({
	operationId: "getRandomParagraph",
	method: "get",
	path: "/random",
	tags: ["Paragraphs"],
	summary: "Get a random paragraph",
	description:
		"Returns a single random paragraph from the Urantia Book. Useful for daily quotes or exploration.\n\nUse `?include=entities` to include typed entity mentions in the response.",
	request: {
		query: IncludeQuery,
	},
	responses: {
		200: {
			description: "A random paragraph",
			content: { "application/json": { schema: ParagraphResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

paragraphsRoute.openapi(getRandomRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { include } = c.req.valid("query");
	const result = await db.select(paragraphFields).from(paragraphs).orderBy(sql`RANDOM()`).limit(1);

	if (result.length === 0) {
	
		return c.json({ error: "No paragraphs found" }, 500);
	}

	const data = wantsEntities(include)
		? (await enrichWithEntities(db, result))[0]!
		: result[0]!;


	return c.json({ data }, 200);
});

// GET /paragraphs/:ref — paragraph by any reference format
const getParagraphRoute = createRoute({
	operationId: "getParagraph",
	method: "get",
	path: "/{ref}",
	tags: ["Paragraphs"],
	summary: "Get a paragraph by reference",
	description: `Look up a paragraph using any of three ID formats:
- **globalId**: "1:2.0.1" (partId:paperId.sectionId.paragraphId)
- **standardReferenceId**: "2:0.1" (paperId:sectionId.paragraphId)
- **paperSectionParagraphId**: "2.0.1" (paperId.sectionId.paragraphId)

The format is auto-detected from the reference string.\n\nUse \`?include=entities\` to include typed entity mentions in the response.`,
	request: {
		params: ParagraphRefParam,
		query: IncludeQuery,
	},
	responses: {
		200: {
			description: "The paragraph",
			content: { "application/json": { schema: ParagraphResponse } },
		},
		400: {
			description: "Invalid reference format",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Paragraph not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

paragraphsRoute.openapi(getParagraphRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { ref } = c.req.valid("param");
	const { include } = c.req.valid("query");
	const format = detectRefFormat(ref);

	if (format === "unknown") {
	
		return c.json(
			{
				error: `Invalid reference format: "${ref}". Expected globalId (1:2.0.1), standardReferenceId (2:0.1), or paperSectionParagraphId (2.0.1)`,
			},
			400,
		);
	}

	const result = await findParagraphByRef(db, ref);

	if (result.length === 0) {
	
		return c.json({ error: `Paragraph "${ref}" not found` }, 404);
	}

	const data = wantsEntities(include)
		? (await enrichWithEntities(db, result))[0]!
		: result[0]!;


	return c.json({ data }, 200);
});

// GET /paragraphs/:ref/context — paragraph with surrounding context
const getParagraphContextRoute = createRoute({
	operationId: "getParagraphContext",
	method: "get",
	path: "/{ref}/context",
	tags: ["Paragraphs"],
	summary: "Get a paragraph with surrounding context",
	description: `Returns the target paragraph along with N paragraphs before and after it (ordered by sort_id).
Useful for AI agents doing RAG that need surrounding context for better understanding.
The \`window\` query parameter controls how many paragraphs before/after to include (default: 2, max: 10).\n\nUse \`?include=entities\` to include typed entity mentions in the response.`,
	request: {
		params: ParagraphRefParam,
		query: ContextQuery,
	},
	responses: {
		200: {
			description: "Paragraph with context",
			content: {
				"application/json": { schema: ParagraphContextResponse },
			},
		},
		400: {
			description: "Invalid reference format",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Paragraph not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

paragraphsRoute.openapi(getParagraphContextRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { ref } = c.req.valid("param");
	const { window: windowSize, include } = c.req.valid("query");
	const format = detectRefFormat(ref);

	if (format === "unknown") {
	
		return c.json(
			{
				error: `Invalid reference format: "${ref}". Expected globalId (1:2.0.1), standardReferenceId (2:0.1), or paperSectionParagraphId (2.0.1)`,
			},
			400,
		);
	}

	const target = await findParagraphByRef(db, ref);

	if (target.length === 0) {
	
		return c.json({ error: `Paragraph "${ref}" not found` }, 404);
	}

	const targetParagraph = target[0]!;

	// Get paragraphs before the target (same paper, lower sort_id)
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

	// Get paragraphs after the target (same paper, higher sort_id)
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

	if (wantsEntities(include)) {
		const allParagraphs = [targetParagraph, ...before, ...after];
		const enriched = await enrichWithEntities(db, allParagraphs);
		const enrichedMap = new Map(enriched.map((p) => [p.id, p]));

	
		return c.json(
			{
				data: {
					target: enrichedMap.get(targetParagraph.id)!,
					before: before.reverse().map((p) => enrichedMap.get(p.id)!),
					after: after.map((p) => enrichedMap.get(p.id)!),
				},
			},
			200,
		);
	}


	return c.json(
		{
			data: {
				target: targetParagraph,
				before: before.reverse(),
				after,
			},
		},
		200,
	);
});
