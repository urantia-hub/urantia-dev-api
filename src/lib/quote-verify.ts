// Decides whether a quoted passage is in a paragraph, word for word or nearly.

export type Verdict = "exact" | "close" | "not_found";

export type Difference = { quote: string; text: string };

export type Score = {
	verdict: Verdict;
	similarity: number;
	coverage: number;
	matchedText: string | null;
	differences: Difference[];
};

type Token = { word: string; surface: string; start: number; end: number };

export const MIN_QUOTE_WORDS = 4;
const CLOSE_THRESHOLD = 0.75;
const MAX_DIFFERENCES = 10;

// Words and numbers, with an inner apostrophe kept ("God's"). Hyphens split words.
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

/** The words of a text, lowercased, with the position of each in the original. */
export function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	for (const match of text.matchAll(WORD)) {
		const surface = match[0];
		const start = match.index ?? 0;
		tokens.push({
			word: surface.toLowerCase().replace(/['’]/g, ""),
			surface,
			start,
			end: start + surface.length,
		});
	}
	return tokens;
}

// Local alignment (Smith-Waterman) on words: it finds the best compact region of the
// paragraph, so common words scattered elsewhere ("the", "of") do not stretch the match.
const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;
const DIAGONAL = 1;
const UP = 2;
const LEFT = 3;

/** Index pairs (quote, text) of the matched words in the best local alignment. */
function alignWords(a: string[], b: string[]): [number, number][] {
	const n = a.length;
	const m = b.length;
	const width = m + 1;
	const score = new Int32Array((n + 1) * width);
	const move = new Uint8Array((n + 1) * width);
	let best = 0;
	let bestAt = 0;
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			const at = i * width + j;
			const diagonal =
				(score[at - width - 1] as number) + (a[i - 1] === b[j - 1] ? MATCH : MISMATCH);
			const up = (score[at - width] as number) + GAP;
			const left = (score[at - 1] as number) + GAP;
			let value = 0;
			let from = 0;
			if (diagonal > value) {
				value = diagonal;
				from = DIAGONAL;
			}
			if (up > value) {
				value = up;
				from = UP;
			}
			if (left > value) {
				value = left;
				from = LEFT;
			}
			score[at] = value;
			move[at] = from;
			if (value > best) {
				best = value;
				bestAt = at;
			}
		}
	}

	const pairs: [number, number][] = [];
	let at = bestAt;
	while (at > 0 && (score[at] as number) > 0) {
		const i = Math.floor(at / width);
		const j = at % width;
		const from = move[at];
		if (from === DIAGONAL) {
			if (a[i - 1] === b[j - 1]) pairs.push([i - 1, j - 1]);
			at -= width + 1;
		} else if (from === UP) {
			at -= width;
		} else if (from === LEFT) {
			at -= 1;
		} else {
			break;
		}
	}
	return pairs.reverse();
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Scores a quote against one paragraph. */
export function scoreQuote(quote: string, paragraph: string): Score {
	const q = tokenize(quote);
	const p = tokenize(paragraph);
	const empty: Score = {
		verdict: "not_found",
		similarity: 0,
		coverage: 0,
		matchedText: null,
		differences: [],
	};
	if (q.length === 0 || p.length === 0) return empty;

	const pairs = alignWords(
		q.map((t) => t.word),
		p.map((t) => t.word),
	);
	if (pairs.length === 0) return empty;

	const first = (pairs[0] as [number, number])[1];
	const last = (pairs[pairs.length - 1] as [number, number])[1];
	const spanLength = last - first + 1;
	const coverage = pairs.length / q.length;
	const similarity = (2 * pairs.length) / (q.length + spanLength);
	const exact = pairs.length === q.length && spanLength === q.length;

	// The gaps between matched words are the differences.
	const differences: Difference[] = [];
	let qi = 0;
	let pj = first;
	for (const [mi, mj] of [...pairs, [q.length, last + 1] as [number, number]]) {
		const quoteGap = q.slice(qi, mi).map((t) => t.surface);
		const textGap = p.slice(pj, mj).map((t) => t.surface);
		if ((quoteGap.length || textGap.length) && differences.length < MAX_DIFFERENCES) {
			differences.push({ quote: quoteGap.join(" "), text: textGap.join(" ") });
		}
		qi = mi + 1;
		pj = mj + 1;
	}

	const verdict: Verdict = exact
		? "exact"
		: coverage >= CLOSE_THRESHOLD && similarity >= CLOSE_THRESHOLD
			? "close"
			: "not_found";

	return {
		verdict,
		similarity: round(similarity),
		coverage: round(coverage),
		matchedText: paragraph.slice((p[first] as Token).start, (p[last] as Token).end),
		differences: exact ? [] : differences,
	};
}

/** The candidate query: every distinct quote word, joined with OR for websearch_to_tsquery. */
export function candidateQuery(quote: string): string {
	return [...new Set(tokenize(quote).map((t) => t.word))].slice(0, 60).join(" or ");
}
