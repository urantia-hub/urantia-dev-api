import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { type CandidateSource, databaseCandidates } from "../lib/quote-candidates.ts";
import {
	candidateQuery,
	MIN_QUOTE_WORDS,
	type Score,
	scoreQuote,
	tokenize,
} from "../lib/quote-verify.ts";
import { ErrorResponse } from "../validators/schemas.ts";

const CANDIDATES = 30;
const VERDICT_RANK = { exact: 2, close: 1, not_found: 0 } as const;

const VerifyBody = z.object({
	text: z.string().min(1).max(2000).describe("The quoted passage to check. At least 4 words."),
	ref: z
		.string()
		.max(40)
		.optional()
		.describe(
			'The reference the quote claims, such as "2:5.1". Optional. When given, that paragraph is checked too.',
		),
});

const Match = z.object({
	reference: z.string(),
	paperId: z.string(),
	paperTitle: z.string(),
	sectionTitle: z.string().nullable(),
	verdict: z.enum(["exact", "close", "not_found"]),
	similarity: z.number(),
	text: z.string().nullable().describe("The exact text at the reference that the quote matches."),
	differences: z
		.array(z.object({ quote: z.string(), text: z.string() }))
		.describe("Each place the quote differs: the quote's words, and the words in the text."),
});

const VerifyResponse = z.object({
	data: z.object({
		verdict: z
			.enum(["exact", "close", "not_found"])
			.describe(
				"exact: word for word. close: the same passage with small changes. not_found: not in the Urantia Papers.",
			),
		match: Match.nullable().describe(
			"The best matching paragraph. For not_found, the nearest one, if any is near.",
		),
		claimedReference: z
			.object({
				ref: z.string(),
				exists: z.boolean(),
				verdict: z.enum(["exact", "close", "not_found"]).nullable(),
			})
			.nullable()
			.describe("The result for the reference the quote claims, when one was given."),
		alsoFoundAt: z
			.array(z.string())
			.describe("Other references where the quote appears word for word."),
	}),
});

const verifyRoute = createRoute({
	operationId: "verifyQuote",
	method: "post",
	path: "/verify",
	tags: ["Quotes"],
	summary: "Check a quote against the text",
	description:
		"Checks whether a quoted passage is in the Urantia Papers. It returns the reference, the exact text, and each word that differs. Case and punctuation are ignored. A quote must be at least 4 words and fall within one paragraph.",
	request: { body: { required: true, content: { "application/json": { schema: VerifyBody } } } },
	responses: {
		200: { description: "The result", content: { "application/json": { schema: VerifyResponse } } },
		400: {
			description: "The quote is empty or too short",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

type Scored = { candidate: Awaited<ReturnType<CandidateSource["search"]>>[number]; score: Score };

const better = (a: Scored, b: Scored) =>
	VERDICT_RANK[a.score.verdict] - VERDICT_RANK[b.score.verdict] ||
	a.score.similarity - b.score.similarity;

function toMatch({ candidate, score }: Scored) {
	return {
		reference: candidate.standardReferenceId,
		paperId: candidate.paperId,
		paperTitle: candidate.paperTitle,
		sectionTitle: candidate.sectionTitle,
		verdict: score.verdict,
		similarity: score.similarity,
		text: score.matchedText,
		differences: score.differences,
	};
}

export function createQuotesRoute(
	source?: (hyperdrive: Hyperdrive | undefined) => CandidateSource,
) {
	const route = createApp();
	route.openapi(verifyRoute, async (c) => {
		const { text, ref } = c.req.valid("json");
		if (tokenize(text).length < MIN_QUOTE_WORDS) {
			return problemJson(
				c,
				400,
				`A quote must be at least ${MIN_QUOTE_WORDS} words to place it.`,
				"quote-too-short",
			);
		}
		const candidates = (source ?? databaseCandidates)(c.env?.HYPERDRIVE);

		const found = await candidates.search(candidateQuery(text), CANDIDATES);
		const claimed = ref ? await candidates.byRef(ref) : null;
		const pool =
			claimed && !found.some((f) => f.standardReferenceId === claimed.standardReferenceId)
				? [...found, claimed]
				: found;

		const scored = pool.map((candidate) => ({
			candidate,
			score: scoreQuote(text, candidate.text),
		}));
		const best = scored.reduce<Scored | null>(
			(top, s) => (!top || better(s, top) > 0 ? s : top),
			null,
		);
		const verdict = best?.score.verdict ?? "not_found";
		// A not_found result names the nearest paragraph only when it is somewhat near.
		const match =
			best && (verdict !== "not_found" || best.score.similarity >= 0.4) ? toMatch(best) : null;
		const claimedScore = claimed
			? scored.find((s) => s.candidate.standardReferenceId === claimed.standardReferenceId)?.score
			: undefined;

		return c.json(
			{
				data: {
					verdict,
					match,
					claimedReference: ref
						? { ref, exists: !!claimed, verdict: claimedScore?.verdict ?? null }
						: null,
					alsoFoundAt: scored
						.filter((s) => s.score.verdict === "exact" && s !== best)
						.map((s) => s.candidate.standardReferenceId),
				},
			},
			200,
		);
	});
	return route;
}

export const quotesRoute = createQuotesRoute();
