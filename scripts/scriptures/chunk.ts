// Groups passages into chunks of about Urantia paragraph size for embedding.
// A chunk never crosses a division or a titled part, and keeps the passages in reading order.
import type { Passage } from "./parsers.ts";

export const MIN_WORDS = 60;
export const MAX_WORDS = 160;

export type Chunk = {
	label: string; // "BG 2.47-49", "Dhp 1-2", "TTC 25"
	sortStart: number;
	sortEnd: number;
	text: string;
	refs: string[];
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The numbers a ref covers: "Dhp 58-59" is 58 to 59, "BG 2.47" is 47 to 47. */
export function refNumbers(ref: string): { start: number; end: number } {
	const m = ref.match(/(\d+)(?:-(\d+))?$/);
	if (!m) throw new Error(`No number in ref ${ref}`);
	const start = Number(m[1]);
	return { start, end: m[2] ? Number(m[2]) : start };
}

/** "BG 2.47" + "BG 2.49" gives "BG 2.47-49". */
export function rangeLabel(first: string, last: string): string {
	if (first === last) return first;
	const end = refNumbers(last).end;
	return `${first.replace(/-\d+$/, "")}-${end}`;
}

/** With `wholeDivisions`, one chunk is one whole chapter or book. */
export function chunkPassages(passages: Passage[], wholeDivisions = false): Chunk[] {
	const chunks: Chunk[] = [];
	let cur: Passage[] = [];
	let count = 0;
	const flush = () => {
		if (!cur.length) return;
		const first = cur[0] as Passage;
		const last = cur[cur.length - 1] as Passage;
		chunks.push({
			label: wholeDivisions ? first.ref.replace(/\.\d+$/, "") : rangeLabel(first.ref, last.ref),
			sortStart: first.sort,
			sortEnd: last.sort,
			text: cur.map((p) => p.text).join(" "),
			refs: cur.map((p) => p.ref),
		});
		cur = [];
		count = 0;
	};
	for (const p of passages) {
		const n = words(p.text);
		const prev = cur[cur.length - 1];
		// A chunk stays inside one division, one subdivision, and one titled part (a life, an oracle).
		const sameDivision =
			prev !== undefined &&
			prev.division === p.division &&
			prev.subdivision === p.subdivision &&
			prev.divisionTitle === p.divisionTitle;
		const full = !wholeDivisions && (count >= MIN_WORDS || count + n > MAX_WORDS);
		if (cur.length && (!sameDivision || full)) flush();
		cur.push(p);
		count += n;
	}
	flush();
	return chunks;
}
