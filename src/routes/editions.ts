import { createRoute } from "@hono/zod-openapi";
import { createApp } from "../lib/app.ts";
import {
	DEFAULT_EDITION,
	EDITIONS,
	editionInfo,
	publicVariant,
	VARIANTS,
} from "../lib/editions.ts";
import { problemJson } from "../lib/errors.ts";
import { detectRefFormat } from "../types/node.ts";
import {
	EditionsListResponse,
	ErrorResponse,
	VariantsListResponse,
	VariantsQuery,
} from "../validators/schemas.ts";

export const editionsRoute = createApp();

// A row with no report year is in every SRT, so it counts with srt-2009 (as in textInEdition).
const changesIn = (year: number) =>
	year === 1955 ? 0 : VARIANTS.filter((v) => (v.year ?? 2009) === year).length;

const listEditionsRoute = createRoute({
	operationId: "listEditions",
	method: "get",
	path: "/",
	tags: ["Editions"],
	summary: "List the editions of the English text",
	description:
		"Returns the editions of the English text that `?edition=` accepts: the first printing (1955) and each Standard Reference Text (SRT). The API stores the newest (`srt-2024`, the Foundation's download 1.22) and builds an older one by undoing the later changes. `changes` is the count of changes adopted in that edition's year. An edition id can also be the Foundation's number (`1.22`, `21`) or a version stamp.",
	responses: {
		200: {
			description: "The editions",
			content: { "application/json": { schema: EditionsListResponse } },
		},
	},
});

editionsRoute.openapi(listEditionsRoute, (c) => {
	const data = EDITIONS.map((e) => ({
		...editionInfo(e),
		default: e.id === DEFAULT_EDITION,
		changes: changesIn(e.year),
	}));
	return c.json({ data, meta: { default: DEFAULT_EDITION, variants: VARIANTS.length } }, 200);
});

const listVariantsRoute = createRoute({
	operationId: "listVariants",
	method: "get",
	path: "/variants",
	tags: ["Editions"],
	summary: "List the changes to the text since 1955",
	description:
		"Returns each change to the English text since the first printing, in the order of the Foundation's list of adopted corrections: the words before and after, the year of the committee report, the 1955 page, and the reason. Filter with `paper`, `ref`, or `kind`. `applied` is false for a change that the Foundation lists but its download does not have yet.",
	request: { query: VariantsQuery },
	responses: {
		200: {
			description: "The changes",
			content: { "application/json": { schema: VariantsListResponse } },
		},
		400: {
			description: "Invalid paper or reference",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

editionsRoute.openapi(listVariantsRoute, (c) => {
	const { paper, ref, kind } = c.req.valid("query");
	const validPaper = (x: string) => /^(0|[1-9]\d{0,2})$/.test(x) && Number(x) <= 196;
	if (paper !== undefined && !validPaper(paper.trim())) {
		return problemJson(
			c,
			400,
			`Invalid paper "${paper}". Use a number from 0 to 196.`,
			"invalid-paper",
		);
	}
	if (ref !== undefined && detectRefFormat(ref) !== "standardReferenceId") {
		return problemJson(
			c,
			400,
			`Invalid reference "${ref}". Use the paper:section.paragraph form, for example 98:3.8.`,
			"invalid-reference-format",
		);
	}
	const rows = VARIANTS.filter(
		(v) =>
			(paper === undefined || v.ref.split(":")[0] === paper.trim()) &&
			(ref === undefined || v.ref === ref.trim()) &&
			(kind === undefined || v.kind === kind),
	);
	const data = rows.map((v) => ({ ref: v.ref, ...publicVariant(v) }));
	return c.json({ data, meta: { total: data.length } }, 200);
});
