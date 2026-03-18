import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { ErrorResponse } from "../validators/schemas.ts";

export const citeRoute = createApp();

const CitationStyleEnum = z.enum(["apa", "mla", "chicago", "bibtex"]);

const CiteQuery = z.object({
	ref: z.string().min(1),
	style: CitationStyleEnum.default("apa"),
});

const CiteResponse = z.object({
	data: z.object({
		ref: z.string(),
		style: CitationStyleEnum,
		citation: z.string(),
	}),
});

/**
 * Parse a standardReferenceId (e.g. "196:2.1") into paper, section, paragraph parts.
 * Also accepts globalId "1:196.2.1" and paperSectionParagraphId "196.2.1".
 */
function parseRef(ref: string): { paperId: string; sectionId: string; paragraphId: string } | null {
	// standardReferenceId: "196:2.1" → paper 196, section 2, paragraph 1
	let match = ref.match(/^(\d+):(\d+)\.(\d+)$/);
	if (match) {
		return { paperId: match[1]!, sectionId: match[2]!, paragraphId: match[3]! };
	}

	// globalId: "1:196.2.1" → paper 196, section 2, paragraph 1
	match = ref.match(/^\d+:(\d+)\.(\d+)\.(\d+)$/);
	if (match) {
		return { paperId: match[1]!, sectionId: match[2]!, paragraphId: match[3]! };
	}

	// paperSectionParagraphId: "196.2.1" → paper 196, section 2, paragraph 1
	match = ref.match(/^(\d+)\.(\d+)\.(\d+)$/);
	if (match) {
		return { paperId: match[1]!, sectionId: match[2]!, paragraphId: match[3]! };
	}

	return null;
}

function formatCitation(
	style: z.infer<typeof CitationStyleEnum>,
	paperId: string,
	sectionId: string,
	paragraphId: string,
): string {
	const location = `Paper ${paperId}, Section ${sectionId}, Paragraph ${paragraphId}`;

	switch (style) {
		case "apa":
			return `The Urantia Book. (1955). Urantia Foundation. ${location}.`;
		case "mla":
			return `The Urantia Book. Urantia Foundation, 1955. ${location}.`;
		case "chicago":
			return `The Urantia Book. Chicago: Urantia Foundation, 1955. ${location}.`;
		case "bibtex":
			return `@book{urantiabook, title={The Urantia Book}, publisher={Urantia Foundation}, year={1955}, note={${location}}}`;
	}
}

const getCiteRoute = createRoute({
	operationId: "getCitation",
	method: "get",
	path: "/",
	tags: ["Citation"],
	summary: "Format a citation for a passage",
	description: `Generate a formatted citation for any Urantia Book passage. Supports APA, MLA, Chicago, and BibTeX styles.

Reference formats accepted:
- **standardReferenceId**: "196:2.1" (paperId:sectionId.paragraphId)
- **globalId**: "1:196.2.1" (partId:paperId.sectionId.paragraphId)
- **paperSectionParagraphId**: "196.2.1" (paperId.sectionId.paragraphId)`,
	request: {
		query: CiteQuery,
	},
	responses: {
		200: {
			description: "Formatted citation",
			content: { "application/json": { schema: CiteResponse } },
		},
		400: {
			description: "Invalid reference format",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

citeRoute.openapi(getCiteRoute, async (c) => {
	const { ref, style } = c.req.valid("query");
	const parsed = parseRef(ref);

	if (!parsed) {
		return problemJson(
			c,
			400,
			`Invalid reference format: "${ref}". Expected formats: "196:2.1", "1:196.2.1", or "196.2.1"`,
			"invalid-reference-format",
		);
	}

	const citation = formatCitation(style, parsed.paperId, parsed.sectionId, parsed.paragraphId);

	return c.json(
		{
			data: {
				ref,
				style,
				citation,
			},
		},
		200,
	);
});
