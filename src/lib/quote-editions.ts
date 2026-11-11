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

export type EditionScore = { score: Score; edition: Edition };

const DEFAULT = EDITIONS.find((e) => e.id === DEFAULT_EDITION) as Edition;

/** The best score of a quote over the editions of a paragraph. A tie goes to the newer edition. */
export function scoreInEditions(quote: string, ref: string, stored: string): EditionScore {
	let best: EditionScore = { score: scoreQuote(quote, stored), edition: DEFAULT };
	const seen = new Set([stored]);
	// Newest first, so an older edition wins only with a strictly better score.
	for (const edition of [...EDITIONS].reverse()) {
		if (edition.id === DEFAULT_EDITION || undoneIn(ref, edition).length === 0) continue;
		let text: string;
		try {
			text = textInEdition(ref, stored, edition);
		} catch {
			continue; // The stored text does not hold the change: score the stored text only.
		}
		if (seen.has(text)) continue;
		seen.add(text);
		const score = scoreQuote(quote, text);
		if (scoreBetter(score, best.score) > 0) best = { score, edition };
	}
	return best;
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
