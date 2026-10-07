import { createRoute } from "@hono/zod-openapi";
import { and, asc, desc, eq, isNotNull, ne, type SQL, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { paragraphScriptureScores, paragraphs, scriptureMutualPairs } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import {
	loadPassages,
	profileList,
	resolveInsightCorpus,
	textSummaries,
} from "../lib/scripture-scores.ts";
import {
	ErrorResponse,
	InsightsCorpusQuery,
	InsightsLeansResponse,
	InsightsPairsResponse,
	InsightsQuery,
	InsightsScoredResponse,
} from "../validators/schemas.ts";

export const scriptureInsightsRoute = createApp();

const METHOD = `Scores come from the nine world religions texts and the World English Bible. For each text, a paragraph's best match becomes a percentile within that text, after an adjustment for paragraph length. The texts are not independent votes: a paragraph that sounds devotional tends to score well in all of them. These are measures of closeness in meaning by an embedding model, not claims about the teachings.`;

const paragraphFields = {
	id: paragraphs.id,
	standardReferenceId: paragraphs.standardReferenceId,
	paperId: paragraphs.paperId,
	paperTitle: paragraphs.paperTitle,
	sectionTitle: paragraphs.sectionTitle,
	text: paragraphs.text,
};

const errors = {
	400: {
		description: "Invalid request",
		content: { "application/json": { schema: ErrorResponse } },
	},
	500: {
		description: "Internal server error",
		content: { "application/json": { schema: ErrorResponse } },
	},
};

function placeFilter(paperId?: number, partId?: number): SQL[] {
	const out: SQL[] = [];
	if (paperId !== undefined) out.push(eq(paragraphs.paperId, String(paperId)));
	if (partId !== undefined) out.push(eq(paragraphs.partId, String(partId)));
	return out;
}

const meta = (page: number, limit: number, total: number) => ({
	page,
	limit,
	total,
	totalPages: Math.ceil(total / limit),
});

// GET /scriptures/insights/shared-currents and /far share one shape.
function scoredRoute(path: string, operationId: string, summary: string, description: string) {
	return createRoute({
		operationId,
		method: "get",
		path,
		tags: ["Scriptures"],
		summary,
		description: `${description}\n\n${METHOD}`,
		request: { query: InsightsQuery },
		responses: {
			200: {
				description: summary,
				content: { "application/json": { schema: InsightsScoredResponse } },
			},
			...errors,
		},
	});
}

const currentsRoute = scoredRoute(
	"/shared-currents",
	"listSharedCurrents",
	"Paragraphs close to many texts",
	"Urantia paragraphs ranked by their mean percentile across the texts, highest first. Paper 131 is left out, because it is a collection of sayings from these religions. Filter by `paperId` or `partId`.",
);

const farRoute = scoredRoute(
	"/far",
	"listFarFromTexts",
	"Paragraphs far from every text",
	"Urantia paragraphs ranked by distance: 1 minus their highest percentile in any text. Subjects that the scriptures do not discuss, such as geology, rank high, so filter by `paperId` or `partId` to compare paragraphs on one subject.",
);

type Db = ReturnType<typeof getDb>["db"];
type ScoredQuery = {
	paperId?: number;
	partId?: number;
	minLength: number;
	page: number;
	limit: number;
};

async function listScored(
	db: Db,
	q: ScoredQuery,
	order: "consensus" | "distance",
	excludePaper131: boolean,
) {
	const conditions = placeFilter(q.paperId, q.partId);
	conditions.push(sql`length(${paragraphs.text}) >= ${q.minLength}`);
	if (excludePaper131) conditions.push(ne(paragraphs.paperId, "131"));
	const where = conditions.length ? and(...conditions) : undefined;
	const column =
		order === "consensus" ? paragraphScriptureScores.consensus : paragraphScriptureScores.distance;
	const [rows, count, texts] = await Promise.all([
		db
			.select({ ...paragraphFields, s: paragraphScriptureScores })
			.from(paragraphScriptureScores)
			.innerJoin(paragraphs, eq(paragraphScriptureScores.paragraphId, paragraphs.id))
			.where(where)
			.orderBy(desc(column), asc(paragraphs.sortId))
			.limit(q.limit)
			.offset(q.page * q.limit),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(paragraphScriptureScores)
			.innerJoin(paragraphs, eq(paragraphScriptureScores.paragraphId, paragraphs.id))
			.where(where),
		textSummaries(db),
	]);
	const data = rows.map(({ s, ...paragraph }) => ({
		paragraph,
		textsClose: s.textsClose,
		consensus: s.consensus,
		distance: s.distance,
		closest: profileList(s.profile as Record<string, number>, texts).slice(0, 3),
	}));
	return { data, meta: meta(q.page, q.limit, Number(count[0]?.n ?? 0)) };
}

scriptureInsightsRoute.openapi(currentsRoute, async (c) =>
	c.json(
		await listScored(getDb(c.env?.HYPERDRIVE).db, c.req.valid("query"), "consensus", true),
		200,
	),
);
scriptureInsightsRoute.openapi(farRoute, async (c) =>
	c.json(
		await listScored(getDb(c.env?.HYPERDRIVE).db, c.req.valid("query"), "distance", false),
		200,
	),
);

// GET /scriptures/insights/pairs
const pairsRoute = createRoute({
	operationId: "listMutualPairs",
	method: "get",
	path: "/pairs",
	tags: ["Scriptures"],
	summary: "Paragraphs and passages that are each other's best match",
	description: `A Urantia paragraph and a passage where each is the other's closest match in that text, under both text-embedding-3-large and text-embedding-3-small. These are the most stable links in the data. Ranked by similarity. Filter with \`corpus\` (a corpus name or \`bible\`).\n\n${METHOD}`,
	request: { query: InsightsCorpusQuery },
	responses: {
		200: {
			description: "Mutual pairs",
			content: { "application/json": { schema: InsightsPairsResponse } },
		},
		...errors,
	},
});

scriptureInsightsRoute.openapi(pairsRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { corpus, excludeBible, page, limit } = c.req.valid("query");
	let corpusId: string | undefined;
	if (corpus) {
		corpusId = await resolveInsightCorpus(db, corpus);
		if (!corpusId) return problemJson(c, 400, `Scripture "${corpus}" not found`);
	}
	const where = corpusId
		? eq(scriptureMutualPairs.corpusId, corpusId)
		: excludeBible === "true"
			? ne(scriptureMutualPairs.corpusId, "bible")
			: undefined;
	const [rows, count, texts] = await Promise.all([
		db
			.select({ ...paragraphFields, pair: scriptureMutualPairs })
			.from(scriptureMutualPairs)
			.innerJoin(paragraphs, eq(scriptureMutualPairs.paragraphId, paragraphs.id))
			.where(where)
			.orderBy(desc(scriptureMutualPairs.similarity))
			.limit(limit)
			.offset(page * limit),
		db.select({ n: sql<number>`count(*)::int` }).from(scriptureMutualPairs).where(where),
		textSummaries(db),
	]);
	const passages = await loadPassages(
		db,
		rows.map((r) => r.pair),
	);
	const data = rows.flatMap(({ pair, ...paragraph }) => {
		const corpusSummary = texts.get(pair.corpusId);
		const passage = passages.get(pair.chunkId);
		return corpusSummary && passage
			? [
					{
						paragraph,
						corpus: corpusSummary,
						passage,
						similarity: pair.similarity,
						similaritySmall: pair.similaritySmall,
					},
				]
			: [];
	});
	return c.json({ data, meta: meta(page, limit, Number(count[0]?.n ?? 0)) }, 200);
});

// GET /scriptures/insights/leans
const leansRoute = createRoute({
	operationId: "listLeans",
	method: "get",
	path: "/leans",
	tags: ["Scriptures"],
	summary: "Paragraphs that lean toward one text",
	description: `Urantia paragraphs whose closest text stands out above their mean across texts, ranked by that gap. A lean counts only when the text has the paragraph in its top 10% and both embedding models pick the same text. Filter with \`corpus\` (a corpus name or \`bible\`).\n\n${METHOD}`,
	request: { query: InsightsCorpusQuery },
	responses: {
		200: {
			description: "Leans",
			content: { "application/json": { schema: InsightsLeansResponse } },
		},
		...errors,
	},
});

scriptureInsightsRoute.openapi(leansRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { corpus, minLength, page, limit } = c.req.valid("query");
	let corpusId: string | undefined;
	if (corpus) {
		corpusId = await resolveInsightCorpus(db, corpus);
		if (!corpusId) return problemJson(c, 400, `Scripture "${corpus}" not found`);
	}
	const where = and(
		corpusId
			? eq(paragraphScriptureScores.leanCorpus, corpusId)
			: isNotNull(paragraphScriptureScores.leanCorpus),
		sql`length(${paragraphs.text}) >= ${minLength}`,
	);
	const [rows, count, texts] = await Promise.all([
		db
			.select({ ...paragraphFields, s: paragraphScriptureScores })
			.from(paragraphScriptureScores)
			.innerJoin(paragraphs, eq(paragraphScriptureScores.paragraphId, paragraphs.id))
			.where(where)
			.orderBy(desc(paragraphScriptureScores.leanGap))
			.limit(limit)
			.offset(page * limit),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(paragraphScriptureScores)
			.innerJoin(paragraphs, eq(paragraphScriptureScores.paragraphId, paragraphs.id))
			.where(where),
		textSummaries(db),
	]);
	const data = rows.flatMap(({ s, ...paragraph }) => {
		const corpusSummary = s.leanCorpus ? texts.get(s.leanCorpus) : undefined;
		const profile = s.profile as Record<string, number>;
		return corpusSummary && s.leanGap !== null
			? [
					{
						paragraph,
						corpus: corpusSummary,
						gap: s.leanGap,
						percentile: profile[corpusSummary.id] ?? 0,
					},
				]
			: [];
	});
	return c.json({ data, meta: meta(page, limit, Number(count[0]?.n ?? 0)) }, 200);
});
