import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { papers, parts } from "../db/schema.ts";
import { ErrorResponse, TocResponse } from "../validators/schemas.ts";

export const tocRoute = new OpenAPIHono();

const getTocRoute = createRoute({
	operationId: "getToc",
	method: "get",
	path: "/",
	tags: ["Table of Contents"],
	summary: "Get the full table of contents",
	description:
		"Returns the complete table of contents with parts and their papers. This is typically the first endpoint an AI agent should call to understand the book structure.",
	responses: {
		200: {
			description: "Table of contents",
			content: { "application/json": { schema: TocResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

tocRoute.openapi(getTocRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);

	const allParts = await db
		.select()
		.from(parts)
		.orderBy(parts.sortId);

	const allPapers = await db
		.select()
		.from(papers)
		.orderBy(papers.sortId);

	const tocParts = allParts.map((part) => ({
		id: part.id,
		title: part.title,
		sponsorship: part.sponsorship,
		papers: allPapers
			.filter((p) => p.partId === part.id)
			.map((p) => ({
				id: p.id,
				title: p.title,
				labels: p.labels,
			})),
	}));

	return c.json({ data: { parts: tocParts } }, 200);
});
