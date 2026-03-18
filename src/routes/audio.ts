import { createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { detectRefFormat } from "../types/node.ts";
import { AudioParam, AudioResponse, ErrorResponse } from "../validators/schemas.ts";

export const audioRoute = createApp();

const getAudioRoute = createRoute({
	operationId: "getAudio",
	method: "get",
	path: "/{paragraphId}",
	tags: ["Audio"],
	summary: "Get audio URL for a paragraph",
	description:
		"Returns the audio file URL for a given paragraph. Accepts any paragraph reference format (globalId, standardReferenceId, or paperSectionParagraphId).",
	request: {
		params: AudioParam,
	},
	responses: {
		200: {
			description: "Audio information",
			content: { "application/json": { schema: AudioResponse } },
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

audioRoute.openapi(getAudioRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { paragraphId } = c.req.valid("param");
	const format = detectRefFormat(paragraphId);

	const col =
		format === "globalId"
			? paragraphs.globalId
			: format === "standardReferenceId"
				? paragraphs.standardReferenceId
				: format === "paperSectionParagraphId"
					? paragraphs.paperSectionParagraphId
					: null;

	if (!col) {
	
		return problemJson(c, 404, `Invalid paragraph reference: "${paragraphId}"`);
	}

	const result = await db
		.select({
			globalId: paragraphs.globalId,
			audio: paragraphs.audio,
		})
		.from(paragraphs)
		.where(eq(col, paragraphId))
		.limit(1);



	if (!result || result.length === 0) {
		return problemJson(c, 404, `Paragraph "${paragraphId}" not found`);
	}

	const row = result[0]!;
	return c.json(
		{
			data: {
				paragraphId: row.globalId,
				audio: row.audio ?? null,
			},
		},
		200,
	);
});
