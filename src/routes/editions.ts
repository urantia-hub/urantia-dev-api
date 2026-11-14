import { createRoute } from "@hono/zod-openapi";
import { createApp } from "../lib/app.ts";
import { editionsList, findVariants } from "../lib/editions.ts";
import { problemJson } from "../lib/errors.ts";
import {
	EditionsListResponse,
	ErrorResponse,
	VariantsListResponse,
	VariantsQuery,
} from "../validators/schemas.ts";

export const editionsRoute = createApp();

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

editionsRoute.openapi(listEditionsRoute, (c) => c.json(editionsList(), 200));

const listVariantsRoute = createRoute({
	operationId: "listVariants",
	method: "get",
	path: "/variants",
	tags: ["Editions"],
	summary: "List the changes to the text since 1955",
	description:
		"Returns each change to the English text since the first printing, in the order of the Foundation's list of adopted corrections: the words before and after, the year of the committee report, the 1955 page, and the reason. Filter with `paper`, `ref`, `kind`, `edition` (the changes adopted in that one edition; `srt-2009` also holds the changes that no report dates, and `1955` has none), or `from` and `to` (each change between two editions: `from=1955&to=srt-2015` compares the first printing with srt-2015). `applied` is false for a change that the Foundation lists but its download does not have yet; `meta.applied` counts those that it has.",
	request: { query: VariantsQuery },
	responses: {
		200: {
			description: "The changes",
			content: { "application/json": { schema: VariantsListResponse } },
		},
		400: {
			description: "Invalid paper, reference, or edition",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

editionsRoute.openapi(listVariantsRoute, (c) => {
	const found = findVariants(c.req.valid("query"));
	if ("error" in found) return problemJson(c, 400, found.error, found.type);
	return c.json(found, 200);
});
