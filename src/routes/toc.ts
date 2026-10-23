import { createRoute } from "@hono/zod-openapi";
import { getDb } from "../db/client.ts";
import { papers, parts } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { loadTitleMap } from "../lib/translations.ts";
import { ErrorResponse, LangQuery, TocResponse } from "../validators/schemas.ts";

export const tocRoute = createApp();

const getTocRoute = createRoute({
	operationId: "getToc",
	method: "get",
	path: "/",
	tags: ["Table of Contents"],
	summary: "Get the full table of contents",
	description:
		"Returns the complete table of contents with parts and their papers. This is typically the first endpoint an AI agent should call to understand the book structure.",
	request: {
		query: LangQuery,
	},
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
	const { lang } = c.req.valid("query");
	const titles = await loadTitleMap(db, lang, ["part", "part-sponsorship", "paper"]);

	const allParts = await db.select().from(parts).orderBy(parts.sortId);

	const allPapers = await db
		.select({ id: papers.id, partId: papers.partId, title: papers.title, labels: papers.labels })
		.from(papers)
		.orderBy(papers.sortId);

	const tocParts = allParts.map((part) => ({
		id: part.id,
		title: titles.get(`part:${part.id}`) ?? part.title,
		sponsorship: titles.get(`part-sponsorship:${part.id}`) ?? part.sponsorship,
		papers: allPapers
			.filter((p) => p.partId === part.id)
			.map((p) => ({
				id: p.id,
				title: titles.get(`paper:${p.id}`) ?? p.title,
				labels: p.labels,
			})),
	}));

	return c.json({ data: { parts: tocParts } }, 200);
});
