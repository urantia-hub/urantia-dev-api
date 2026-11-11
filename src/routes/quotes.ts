import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { createApp } from "../lib/app.ts";
import { DEFAULT_EDITION, type Edition, publicVariant, variantsOf } from "../lib/editions.ts";
import { problemJson } from "../lib/errors.ts";
import { type CandidateSource, databaseCandidates } from "../lib/quote-candidates.ts";
import { olderWordingRefs, scoreBetter, scoreInEditions } from "../lib/quote-editions.ts";
import { candidateQuery, MIN_QUOTE_WORDS, type Score, tokenize } from "../lib/quote-verify.ts";
import { ErrorResponse, VariantSchema } from "../validators/schemas.ts";

const CANDIDATES = 30;
// At most this many paragraphs join the search results because the quote uses their older wording.
const OLDER_WORDING_CANDIDATES = 5;

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
	edition: z
		.string()
		.describe(
			'The edition of the text that the quote matches best: "srt-2024" (the default), or an older one such as "1955" when the quote has the older wording.',
		),
	variants: z
		.array(VariantSchema)
		.optional()
		.describe("When `edition` is an older edition: the changes to this paragraph since 1955."),
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
		"Checks whether a quoted passage is in the Urantia Papers. It returns the reference, the exact text, and each word that differs. Case and punctuation are ignored. A quote must be at least 4 words and fall within one paragraph. A quote of an older edition (such as the 1955 first printing) also matches: `match.edition` names the edition, and `match.variants` gives the changes.",
	request: { body: { required: true, content: { "application/json": { schema: VerifyBody } } } },
	responses: {
		200: { description: "The result", content: { "application/json": { schema: VerifyResponse } } },
		400: {
			description: "The quote is empty or too short",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

type Candidate = Awaited<ReturnType<CandidateSource["search"]>>[number];
type Scored = { candidate: Candidate; score: Score; edition: Edition };

function toMatch({ candidate, score, edition }: Scored) {
	return {
		reference: candidate.standardReferenceId,
		paperId: candidate.paperId,
		paperTitle: candidate.paperTitle,
		sectionTitle: candidate.sectionTitle,
		verdict: score.verdict,
		similarity: score.similarity,
		text: score.matchedText,
		differences: score.differences,
		edition: edition.id,
		...(edition.id !== DEFAULT_EDITION
			? { variants: variantsOf(candidate.standardReferenceId).map(publicVariant) }
			: {}),
	};
}

/** The result of a quote check, shared by POST /quotes/verify and the MCP tool `quotes.verify`. Null for a quote under 4 words. */
export async function verifyQuote(candidates: CandidateSource, text: string, ref?: string) {
	if (tokenize(text).length < MIN_QUOTE_WORDS) return null;
	const found = await candidates.search(candidateQuery(text), CANDIDATES);
	const claimed = ref ? await candidates.byRef(ref) : null;
	const pool = [...found];
	const add = (c: Candidate | null) => {
		if (c && !pool.some((p) => p.standardReferenceId === c.standardReferenceId)) pool.push(c);
	};
	add(claimed);
	// A paragraph whose older wording the quote uses is a candidate even when search missed it.
	const older = olderWordingRefs(text)
		.filter((r) => !pool.some((p) => p.standardReferenceId === r))
		.slice(0, OLDER_WORDING_CANDIDATES);
	for (const c of await Promise.all(older.map((r) => candidates.byRef(r)))) add(c);
	const scored: Scored[] = pool.map((candidate) => ({
		candidate,
		...scoreInEditions(text, candidate.standardReferenceId, candidate.text),
	}));
	const best = scored.reduce<Scored | null>(
		(top, s) => (!top || scoreBetter(s.score, top.score) > 0 ? s : top),
		null,
	);
	const verdict = best?.score.verdict ?? "not_found";
	// A not_found result names the nearest paragraph only when it is somewhat near.
	const match =
		best && (verdict !== "not_found" || best.score.similarity >= 0.4) ? toMatch(best) : null;
	const claimedScore = claimed
		? scored.find((s) => s.candidate.standardReferenceId === claimed.standardReferenceId)?.score
		: undefined;
	return {
		verdict,
		match,
		claimedReference: ref
			? { ref, exists: !!claimed, verdict: claimedScore?.verdict ?? null }
			: null,
		alsoFoundAt: scored
			.filter((s) => s.score.verdict === "exact" && s !== best)
			.map((s) => s.candidate.standardReferenceId),
	};
}

export function createQuotesRoute(
	source?: (hyperdrive: Hyperdrive | undefined) => CandidateSource,
) {
	const route = createApp();

	route.openapi(verifyRoute, async (c) => {
		const { text, ref } = c.req.valid("json");
		const data = await verifyQuote((source ?? databaseCandidates)(c.env?.HYPERDRIVE), text, ref);
		if (!data) {
			return problemJson(
				c,
				400,
				`A quote must be at least ${MIN_QUOTE_WORDS} words to place it.`,
				"quote-too-short",
			);
		}
		return c.json({ data }, 200);
	});

	return route;
}

export const quotesRoute = createQuotesRoute();
