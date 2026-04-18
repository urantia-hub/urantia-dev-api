import { createRoute } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { papers, paragraphs, sections } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { aggregateTopEntities, enrichWithEntities, wantsEntities } from "../lib/entities.ts";
import { problemJson } from "../lib/errors.ts";
import {
	ErrorResponse,
	IncludeQuery,
	PaperDetailResponse,
	PaperIdParam,
	PapersListResponse,
	SectionsResponse,
} from "../validators/schemas.ts";

export const papersRoute = createApp();

// GET /papers — list all papers
const listPapersRoute = createRoute({
	operationId: "listPapers",
	method: "get",
	path: "/",
	tags: ["Papers"],
	summary: "List all 197 papers",
	description: "Returns metadata for all papers in the Urantia Book, ordered by paper number.",
	responses: {
		200: {
			description: "List of all papers",
			content: { "application/json": { schema: PapersListResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

papersRoute.openapi(listPapersRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const allPapers = await db
		.select({
			id: papers.id,
			partId: papers.partId,
			title: papers.title,
			sortId: papers.sortId,
			labels: papers.labels,
			video: papers.video,
		})
		.from(papers)
		.orderBy(papers.sortId);


	return c.json({ data: allPapers }, 200);
});

// GET /papers/:id — single paper with all paragraphs
const getPaperRoute = createRoute({
	operationId: "getPaper",
	method: "get",
	path: "/{id}",
	tags: ["Papers"],
	summary: "Get a paper with all its paragraphs",
	description:
		"Returns a single paper's metadata along with all its paragraphs in order. Paper IDs range from 0 (Foreword) to 196.\n\nUse `?include=entities` to include typed entity mentions in each paragraph.",
	request: {
		params: PaperIdParam,
		query: IncludeQuery,
	},
	responses: {
		200: {
			description: "Paper with paragraphs",
			content: { "application/json": { schema: PaperDetailResponse } },
		},
		404: {
			description: "Paper not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

papersRoute.openapi(getPaperRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { id } = c.req.valid("param");
	const { include } = c.req.valid("query");

	const paper = await db
		.select({
			id: papers.id,
			partId: papers.partId,
			title: papers.title,
			sortId: papers.sortId,
			labels: papers.labels,
			video: papers.video,
		})
		.from(papers)
		.where(eq(papers.id, id))
		.limit(1);

	if (paper.length === 0) {
	
		return problemJson(c, 404, `Paper ${id} not found`);
	}

	const paperParagraphs = await db
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
		})
		.from(paragraphs)
		.where(eq(paragraphs.paperId, id))
		.orderBy(paragraphs.sortId);

	if (wantsEntities(include)) {
		// Attach per-paragraph entity mentions AND a paper-level topEntities
		// aggregate — the N most-referenced named entities in this paper,
		// sorted by frequency. Useful for UI chips, YouTube tags, SEO, etc.
		const enriched = await enrichWithEntities(db, paperParagraphs);
		return c.json(
			{
				data: {
					paper: { ...paper[0]!, topEntities: aggregateTopEntities(enriched) },
					paragraphs: enriched,
				},
			},
			200,
		);
	}

	return c.json(
		{
			data: {
				paper: paper[0]!,
				paragraphs: paperParagraphs,
			},
		},
		200,
	);
});

// GET /papers/:id/sections — sections within a paper
const getPaperSectionsRoute = createRoute({
	operationId: "getPaperSections",
	method: "get",
	path: "/{id}/sections",
	tags: ["Papers"],
	summary: "Get sections within a paper",
	description: "Returns all sections for a given paper, ordered by section number.",
	request: {
		params: PaperIdParam,
	},
	responses: {
		200: {
			description: "List of sections",
			content: { "application/json": { schema: SectionsResponse } },
		},
		404: {
			description: "Paper not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

papersRoute.openapi(getPaperSectionsRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { id } = c.req.valid("param");

	const paper = await db.select().from(papers).where(eq(papers.id, id)).limit(1);

	if (paper.length === 0) {
	
		return problemJson(c, 404, `Paper ${id} not found`);
	}

	const paperSections = await db
		.select()
		.from(sections)
		.where(eq(sections.paperId, id))
		.orderBy(sections.sortId);


	return c.json({ data: paperSections }, 200);
});
