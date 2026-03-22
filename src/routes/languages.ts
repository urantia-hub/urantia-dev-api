import { createRoute } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { entityTranslations, paragraphTranslations } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { ErrorResponse, LanguagesResponse } from "../validators/schemas.ts";

export const languagesRoute = createApp();

const LANG_NAMES: Record<string, string> = {
	eng: "English",
	es: "Spanish",
	fr: "French",
	pt: "Portuguese",
	de: "German",
	ko: "Korean",
};

const listLanguagesRoute = createRoute({
	operationId: "listLanguages",
	method: "get",
	path: "/",
	tags: ["Languages"],
	summary: "List available languages",
	description:
		"Returns available languages with translation progress (entity and paragraph counts).",
	responses: {
		200: {
			description: "Available languages with translation counts",
			content: { "application/json": { schema: LanguagesResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

languagesRoute.openapi(listLanguagesRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);

	// Count entity translations per language
	const entityCounts = await db
		.select({
			language: entityTranslations.language,
			count: sql<number>`count(DISTINCT ${entityTranslations.entityId})`,
		})
		.from(entityTranslations)
		.groupBy(entityTranslations.language);

	// Count paragraph translations per language
	const paragraphCounts = await db
		.select({
			language: paragraphTranslations.language,
			count: sql<number>`count(*)`,
		})
		.from(paragraphTranslations)
		.groupBy(paragraphTranslations.language);

	const entityMap = new Map(entityCounts.map((e) => [e.language, Number(e.count)]));
	const paragraphMap = new Map(paragraphCounts.map((p) => [p.language, Number(p.count)]));

	// Build response for all supported languages
	const data = Object.entries(LANG_NAMES).map(([code, name]) => ({
		code,
		name,
		entityCount: entityMap.get(code) ?? 0,
		paragraphCount: paragraphMap.get(code) ?? 0,
	}));

	return c.json({ data }, 200);
});
