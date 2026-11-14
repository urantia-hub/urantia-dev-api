// Quotes of an older edition: score a quote against each edition of a paragraph, and find the
// paragraphs whose older wording a quote uses.
import {
	DEFAULT_EDITION,
	EDITIONS,
	type Edition,
	textInEdition,
	undoneIn,
	VARIANTS,
} from "./editions.ts";
import { type Score, scoreQuote, tokenize, type Verdict } from "./quote-verify.ts";

const RANK: Record<Verdict, number> = { exact: 2, close: 1, not_found: 0 };

/** True when score a is better than score b: a higher verdict, then a higher similarity. */
export const scoreBetter = (a: Score, b: Score) =>
	RANK[a.verdict] - RANK[b.verdict] || a.similarity - b.similarity;

export type EditionScore = {
	score: Score;
	/** The newest edition with the best score. */
	edition: Edition;
	/** Each edition with the best score, oldest first: where the quoted wording is. */
	editions: Edition[];
};

/** The best score of a quote over the editions of a paragraph. A tie goes to the newer edition. */
export function scoreInEditions(quote: string, ref: string, stored: string): EditionScore {
	const byText = new Map<string, Score>();
	// Newest first, so an older edition wins only with a strictly better score.
	const scored = [...EDITIONS].reverse().map((edition) => {
		let text = stored;
		if (edition.id !== DEFAULT_EDITION && undoneIn(ref, edition).length > 0) {
			try {
				text = textInEdition(ref, stored, edition);
			} catch {
				// The stored text does not hold the change: score the stored text.
			}
		}
		let score = byText.get(text);
		if (!score) {
			score = scoreQuote(quote, text);
			byText.set(text, score);
		}
		return { score, edition };
	});
	let best = scored[0] as { score: Score; edition: Edition };
	for (const s of scored) if (scoreBetter(s.score, best.score) > 0) best = s;
	const editions = scored
		.filter((s) => scoreBetter(s.score, best.score) === 0)
		.map((s) => s.edition)
		.reverse();
	return { ...best, editions };
}

// For each change, the old words that only its older wording has: the changed words and one
// neighbor word on each side ("than twoscore", "twoscore self"). Words of the quote are matched
// against these in memory.
type Marker = { ref: string; runs: string[][] };

function markerOf(before: string, after: string): string[][] {
	const b = tokenize(before).map((t) => t.word);
	const a = tokenize(after).map((t) => t.word);
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (
		tail < a.length - head &&
		tail < b.length - head &&
		a[a.length - 1 - tail] === b[b.length - 1 - tail]
	)
		tail++;
	const core = b.slice(head, b.length - tail);
	if (core.length === 0) return []; // Punctuation, or words only added later: no old words.
	const runs: string[][] = [];
	if (head > 0) runs.push([b[head - 1] as string, ...core]);
	if (tail > 0) runs.push([...core, b[b.length - tail] as string]);
	return runs.length ? runs : [core];
}

const MARKERS: Marker[] = VARIANTS.filter((v) => v.kind === "text" && v.inStoredText)
	.map((v) => ({ ref: v.ref, runs: markerOf(v.before, v.after) }))
	.filter((m) => m.runs.length > 0);

const holdsRun = (words: string[], run: string[]) =>
	words.some((_, i) => run.every((w, k) => words[i + k] === w));

/** The references whose older wording the quote uses, in the order of the variants list. */
export function olderWordingRefs(quote: string): string[] {
	const words = tokenize(quote).map((t) => t.word);
	const refs = MARKERS.filter((m) => m.runs.some((run) => holdsRun(words, run))).map((m) => m.ref);
	return [...new Set(refs)];
}
