import { createRoute } from "@hono/zod-openapi";
import OpenAI from "openai";
import { getDb } from "../db/client.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { getCachedEmbedding, runAfter, setCachedEmbedding } from "../lib/search-cache.ts";
import {
	listWorks,
	readWork,
	resolveWork,
	searchWorks,
	semanticSearchWorks,
	type WorksSearchOptions,
	workParallels,
} from "../lib/works.ts";
import {
	ErrorResponse,
	WorkParallelsResponse,
	WorkReadResponse,
	WorkRefParam,
	WorksResponse,
	WorksSearchQueryParams,
	WorksSearchRequest,
	WorksSearchResponse,
} from "../validators/schemas.ts";

// biome-ignore lint: Handler context type varies per route (see search.ts).
type AnyContext = any;

export const worksRoute = createApp();

const PARALLELS_NOTE =
	"**The Urantia parallels are semantic, not curated.** They show the paragraphs closest in meaning by embedding similarity. They do not claim that two teachings are the same.";

const errors = {
	400: {
		description: "Invalid request",
		content: { "application/json": { schema: ErrorResponse } },
	},
	404: {
		description: "Work or reference not found",
		content: { "application/json": { schema: ErrorResponse } },
	},
	500: {
		description: "Internal server error",
		content: { "application/json": { schema: ErrorResponse } },
	},
};

// GET /works
worksRoute.openapi(
	createRoute({
		operationId: "listWorks",
		method: "get",
		path: "/",
		tags: ["Works"],
		summary: "List the works beside the Papers",
		description:
			'The Bible (World English Bible) and the texts of the world\'s religions that Paper 131 summarizes, each in the US public domain. `id` is what the other `/works` endpoints take: `"bible"` or a slug such as `"dhammapada"`. `unitLabel` is the word for one unit of each work (verse, section, pauri).',
		responses: {
			200: { description: "The works", content: { "application/json": { schema: WorksResponse } } },
			500: errors[500],
		},
	}),
	async (c) => {
		const { db } = getDb(c.env?.HYPERDRIVE);
		return c.json({ data: await listWorks(db) }, 200);
	},
);

const keywordDescription = `Keyword search across the Bible and the other works, or one work with \`work\`. A reference such as \`John 3:16\`, \`Jn 3:16-18\`, \`Dhp 183\`, or \`BG 2.47\` gives those units first (\`match: "reference"\`; with \`work\`, the prefix is optional). Otherwise the exact phrase comes first, then every word (the last word can be the start of a word); when these give fewer than 10, a typo fix follows (\`meta.didYouMean\`). Each result carries its nearest Urantia paragraphs (\`urantiaParallelLimit\`, 0 to 10, default 3).\n\n${PARALLELS_NOTE}`;

async function handleKeyword(c: AnyContext, params: WorksSearchOptions) {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const found = await searchWorks(db, params);
	if (!found) return problemJson(c, 400, `Work "${params.work}" not found`);
	c.get("logger")?.info("works_search", {
		query: params.q,
		work: params.work,
		result_count: found.meta.total,
		first_match: found.data[0]?.match,
	});
	return c.json(found, 200);
}

const keywordResponses = {
	200: {
		description: "Search results",
		content: { "application/json": { schema: WorksSearchResponse } },
	},
	400: errors[400],
	500: errors[500],
};

worksRoute.openapi(
	createRoute({
		operationId: "searchWorks",
		method: "post",
		path: "/search",
		tags: ["Works"],
		summary: "Keyword search across the works",
		description: keywordDescription,
		request: {
			body: { required: true, content: { "application/json": { schema: WorksSearchRequest } } },
		},
		responses: keywordResponses,
	}),
	(c) => handleKeyword(c, c.req.valid("json")),
);

worksRoute.openapi(
	createRoute({
		operationId: "searchWorksGet",
		method: "get",
		path: "/search",
		tags: ["Works"],
		summary: "Keyword search across the works (GET)",
		description: `${keywordDescription}\n\nAccepts query parameters instead of a JSON body.`,
		request: { query: WorksSearchQueryParams },
		responses: keywordResponses,
	}),
	(c) => handleKeyword(c, c.req.valid("query")),
);

const semanticDescription = `Natural-language search across the Bible and the other works, or one work with \`work\`. The list holds the 100 nearest chunks (a chunk is a few verses, about one Urantia paragraph long); each has \`similarity\` and \`strength\` (strong, related, weak), and \`meta.total\` is the length of that list, and \`meta.related\` counts those that are related or better. A reference gives those units with no vector. Each result carries its nearest Urantia paragraphs (\`urantiaParallelLimit\`, 0 to 10, default 3).\n\n${PARALLELS_NOTE}`;

async function handleSemantic(c: AnyContext, params: WorksSearchOptions) {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const kv = c.env?.SEARCH_CACHE as KVNamespace | undefined;
	const found = await semanticSearchWorks(db, {
		...params,
		embed: async () => {
			const cached = await getCachedEmbedding(kv, params.q);
			if (cached) return cached;
			const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
			const res = await openai.embeddings.create({
				model: "text-embedding-3-small",
				input: params.q,
			});
			const vector = res.data[0]?.embedding ?? null;
			if (vector) runAfter(c, setCachedEmbedding(kv, params.q, vector));
			return vector;
		},
	});
	if (found === null) return problemJson(c, 400, `Work "${params.work}" not found`);
	if (found === "embedding") return problemJson(c, 500, "Failed to generate embedding");
	c.get("logger")?.info("works_semantic_search", {
		query: params.q,
		work: params.work,
		result_count: found.meta.total,
		first_strength: found.data[0]?.strength,
	});
	return c.json(found, 200);
}

worksRoute.openapi(
	createRoute({
		operationId: "searchWorksSemantic",
		method: "post",
		path: "/search/semantic",
		tags: ["Works"],
		summary: "Semantic search across the works",
		description: semanticDescription,
		request: {
			body: { required: true, content: { "application/json": { schema: WorksSearchRequest } } },
		},
		responses: keywordResponses,
	}),
	(c) => handleSemantic(c, c.req.valid("json")),
);

worksRoute.openapi(
	createRoute({
		operationId: "searchWorksSemanticGet",
		method: "get",
		path: "/search/semantic",
		tags: ["Works"],
		summary: "Semantic search across the works (GET)",
		description: `${semanticDescription}\n\nAccepts query parameters instead of a JSON body.`,
		request: { query: WorksSearchQueryParams },
		responses: keywordResponses,
	}),
	(c) => handleSemantic(c, c.req.valid("query")),
);

// GET /works/{work}/{ref}
worksRoute.openapi(
	createRoute({
		operationId: "readWork",
		method: "get",
		path: "/{work}/{ref}",
		tags: ["Works"],
		summary: "Read a work by reference",
		description:
			"The units of a reference, in order, at most 200: one verse or passage, a short range of up to 50, or a whole chapter. Each has its link. The prefix of the reference is optional: for the Bhagavad Gita, `BG 2.47` and `2.47` are the same; for the Bible, name the book (`John 3:16`, `Jn 3:16`).",
		request: { params: WorkRefParam },
		responses: {
			200: {
				description: "The units",
				content: { "application/json": { schema: WorkReadResponse } },
			},
			...errors,
		},
	}),
	async (c) => {
		const { db } = getDb(c.env?.HYPERDRIVE);
		const { work, ref } = c.req.valid("param");
		if (!(await resolveWork(db, work))) return problemJson(c, 404, `Work "${work}" not found`);
		const units = await readWork(db, ref, work);
		if (!units)
			return problemJson(
				c,
				400,
				`Invalid reference "${ref}" for "${work}"`,
				"invalid-reference-format",
			);
		if (units.length === 0) return problemJson(c, 404, `${ref} not found in "${work}"`);
		return c.json(
			{ data: units.map(({ chunk: _, ...u }) => ({ ...u, urantiaParallels: [] })) },
			200,
		);
	},
);

// GET /works/{work}/{ref}/urantia-parallels
worksRoute.openapi(
	createRoute({
		operationId: "getWorkUrantiaParallels",
		method: "get",
		path: "/{work}/{ref}/urantia-parallels",
		tags: ["Works"],
		summary: "Top 10 Urantia paragraphs for one unit of a work",
		description: `The 10 Urantia paragraphs closest in meaning to the chunk that holds this unit. The reference must name one unit.\n\n${PARALLELS_NOTE}`,
		request: { params: WorkRefParam },
		responses: {
			200: {
				description: "The unit with its top 10 Urantia paragraphs",
				content: { "application/json": { schema: WorkParallelsResponse } },
			},
			...errors,
		},
	}),
	async (c) => {
		const { db } = getDb(c.env?.HYPERDRIVE);
		const { work, ref } = c.req.valid("param");
		if (!(await resolveWork(db, work))) return problemJson(c, 404, `Work "${work}" not found`);
		const found = await workParallels(db, work, ref);
		if (found === "many")
			return problemJson(
				c,
				400,
				`${ref} names more than one unit. Ask for one.`,
				"invalid-reference-format",
			);
		if (!found) return problemJson(c, 404, `${ref} not found in "${work}"`);
		return c.json({ data: found }, 200);
	},
);
