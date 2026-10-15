// Finds where each title, paragraph, and sentence starts in the full audio file of one paper.
// Pure functions: the pauses come from ffmpeg in generate-paper-audio-timing.ts.

export type Pause = { start: number; end: number };
export type Item = {
	kind: "title" | "section" | "para";
	key: string;
	expect: number;
	text?: string;
};
export type Start = { key: string; at: number; sentences?: number[] };
export type Placement = { starts: Start[]; offset: number; worst: number; ends: number[] };

const round = (n: number) => Math.round(n * 100) / 100;

// A title has no audio length in the API: estimate it from its characters.
export function titleLength(text: string, kind: "title" | "section"): number {
	return 0.35 + 0.075 * text.length + (kind === "title" ? 0.8 : 0.4);
}

function spread(item: Item): number {
	return item.kind === "para" ? 0.6 + 0.03 * item.expect : 1.2;
}

/**
 * Chooses one pause after each item, so that the length of each item is near what is expected.
 * The fit is global (dynamic programming), so a sentence pause near the end of a paragraph does not win.
 * The last item ends at the end of the file. Null when the file cannot hold the items.
 */
export function place(items: Item[], pauses: Pause[], total: number): Placement | null {
	const lead = pauses.length > 0 && pauses[0].start < 0.05 ? pauses[0].end : 0;
	const cands: Pause[] = pauses.filter((p) => p.start > lead + 0.2);
	cands.push({ start: total, end: total });
	const n = items.length;
	const m = cands.length;
	if (n === 0) return null;
	const cost: number[][] = items.map(() => new Array(m).fill(Number.POSITIVE_INFINITY));
	const back: number[][] = items.map(() => new Array(m).fill(-1));

	for (let i = 0; i < n; i++) {
		const e = items[i].expect;
		const s = spread(items[i]);
		// A longer pause is a better end: much more so next to a title, where the reader hears a clear break.
		const nearTitle = items[i].kind !== "para" || (i + 1 < n && items[i + 1].kind !== "para");
		for (let j = 0; j < m; j++) {
			if (i === n - 1 && j !== m - 1) continue;
			const bonus = -Math.min(cands[j].end - cands[j].start, 2.5) * (nearTitle ? 1.5 : 0.6);
			if (i === 0) {
				const c = ((cands[j].start - lead - e) / s) ** 2;
				if (c < 25) cost[0][j] = c + bonus;
				continue;
			}
			for (let k = j - 1; k >= 0; k--) {
				if (cost[i - 1][k] === Number.POSITIVE_INFINITY) continue;
				const len = cands[j].start - cands[k].end;
				if (len > e + 6 * s + 4) break;
				if (len <= 0) continue;
				const c = cost[i - 1][k] + ((len - e) / s) ** 2 + bonus;
				if (c < cost[i][j]) {
					cost[i][j] = c;
					back[i][j] = k;
				}
			}
		}
	}
	if (cost[n - 1][m - 1] === Number.POSITIVE_INFINITY) return null;

	const endAt: number[] = new Array(n);
	let j = m - 1;
	for (let i = n - 1; i >= 0; i--) {
		endAt[i] = j;
		j = back[i][j];
	}
	const startTimes = [lead, ...endAt.slice(0, -1).map((e) => cands[e].end)];
	const ends = endAt.map((e) => cands[e].start);

	// Each paragraph in the full file is its own file's length less a constant (the silence at the ends of
	// a paragraph file). The constant is the median; the worst error is measured after it.
	const errors = items.flatMap((item, i) =>
		item.kind === "para" ? [ends[i] - startTimes[i] - item.expect] : [],
	);
	const sorted = [...errors].sort((a, b) => a - b);
	const offset = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
	const worst = errors.reduce((w, e) => Math.max(w, Math.abs(e - offset)), 0);

	return {
		starts: items.map((item, i) => ({ key: item.key, at: round(startTimes[i]) })),
		offset: round(offset),
		worst: round(worst),
		ends: ends.map(round),
	};
}

/**
 * The start of each sentence inside one paragraph that runs from `from` to `to`, from the pauses inside it.
 * Each sentence is expected to take its share of the characters. Null when there are too few pauses.
 */
export function placeSentences(
	parts: string[],
	from: number,
	to: number,
	pauses: Pause[],
): number[] | null {
	if (parts.length === 0) return null;
	if (parts.length === 1) return [round(from)];
	const inside = pauses.filter((p) => p.start > from + 0.3 && p.end < to - 0.3);
	const k = parts.length - 1;
	if (inside.length < k) return null;
	const chars = parts.reduce((n, p) => n + p.length + 1, 0);
	const span = to - from;
	// The expected time of each sentence end, from the characters before it.
	const want: number[] = [];
	let sum = 0;
	for (let i = 0; i < k; i++) {
		sum += parts[i].length + 1;
		want.push(from + (span * sum) / chars);
	}
	const m = inside.length;
	const mid = (p: Pause) => (p.start + p.end) / 2;
	const cost: number[][] = want.map(() => new Array(m).fill(Number.POSITIVE_INFINITY));
	const back: number[][] = want.map(() => new Array(m).fill(-1));
	for (let i = 0; i < k; i++) {
		for (let j = i; j < m; j++) {
			const here =
				((mid(inside[j]) - want[i]) / Math.max(1, span * 0.05)) ** 2 -
				Math.min(inside[j].end - inside[j].start, 1);
			if (i === 0) {
				cost[0][j] = here;
				continue;
			}
			for (let q = i - 1; q < j; q++) {
				const c = cost[i - 1][q] + here;
				if (c < cost[i][j]) {
					cost[i][j] = c;
					back[i][j] = q;
				}
			}
		}
	}
	let best = -1;
	for (let j = k - 1; j < m; j++) if (best === -1 || cost[k - 1][j] < cost[k - 1][best]) best = j;
	const cuts: number[] = new Array(k);
	let j = best;
	for (let i = k - 1; i >= 0; i--) {
		cuts[i] = j;
		j = back[i][j];
	}
	return [round(from), ...cuts.map((c) => round(inside[c].end))];
}

// The sentence rule of the Hub: copied from urantiahub-v2 src/image/compose.ts (`sentences`), so the
// Hub's sentence N is this file's sentence N. Change both together.
const SHORT = /(?:\b(?:A\.D|B\.C|St|Mr|Mrs|Dr|vs|etc|i\.e|e\.g)|^\d+)\.$/;

export function sentences(text: string): string[] {
	const found: string[] = [];
	let current = "";
	for (const part of text.trim().split(/(?<=[.!?][”’"')\]]*)\s+/)) {
		if (!part) continue;
		current = current ? `${current} ${part}` : part;
		if (SHORT.test(current.replace(/[”’"')\]]+$/, ""))) continue;
		found.push(current);
		current = "";
	}
	if (current) found.push(current);
	return found;
}

/**
 * A start moved back into the pause that ends at it, by up to `lead` seconds. A soft first word ("The")
 * begins before the pause end that the detector finds, and a seek in an MP3 can land a little late.
 */
export function leadIn(
	at: number,
	pauses: Pause[],
	after = Number.NEGATIVE_INFINITY,
	lead = 0.3,
): number {
	const pause = pauses.find((p) => Math.abs(p.end - at) < 0.01);
	if (!pause) return at;
	// It stays 50 ms after the start before it, and never moves later than `at`.
	const from = Math.min(at, Math.max(pause.start, at - lead, after + 0.05));
	return Math.round(from * 1000) / 1000;
}
