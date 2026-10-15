// Checks each placed start against the words a speech model hears there, and moves a start that is off.
// Pure: the speech model comes in as `hear` (scripts/audio-timing/hear.py in the real run).
import type { Pause } from "./place";

// Numbers are left out on both sides: the model writes "31" for "thirty-one" and says "number one" for "1.".
const NUMBER =
	/^(\d+(st|nd|rd|th)?|number|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)$/;

// The words of a text, without its numbers. An "and" inside a number goes too ("two hundred and eighty").
function words(text: string): string[] {
	const all = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
	return all.filter(
		(w, i) =>
			!NUMBER.test(w) &&
			!(w === "and" && NUMBER.test(all[i - 1] ?? "") && NUMBER.test(all[i + 1] ?? "")),
	);
}

const SPOKEN = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
];

// The first number in the heard words, as digits.
function firstNumber(heard: string): string | null {
	for (const w of heard.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
		if (/^\d+$/.test(w)) return w;
		if (SPOKEN.includes(w)) return String(SPOKEN.indexOf(w));
	}
	return null;
}

function distance(a: string, b: string): number {
	let row = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++) {
			next[j] = Math.min(
				(row[j] ?? 0) + 1,
				(next[j - 1] ?? 0) + 1,
				(row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		row = next;
	}
	return row[b.length] ?? 0;
}

/**
 * True when the first words heard are the first words of the text, with room for the spelling of a name.
 * The voice says "Paper 44" before a paper title.
 */
export function heardMatches(heard: string, text: string): boolean {
	return matchCost(heard, text) !== null;
}

// The skips that a match can use: words of the model dropped first, then words of the text, in order of cost.
const SKIPS: [number, number][] = [
	[0, 0],
	[1, 0],
	[0, 1],
	[2, 0],
	[0, 2],
	[1, 1],
];

/**
 * The words dropped to make the heard words match the start of the text: 0 for an exact start, null for none.
 * The model can drop the first word or two of a start ("Presented by"), or hear the end of the item before.
 * After a skip the compare is stricter, and needs more letters.
 */
export function matchCost(heard: string, text: string): number | null {
	// The voice does not read the Roman number of a section title ("II. God").
	const want = words(text.replace(/^[IVXLC]+\.\s+/, ""));
	if (want.length === 0) return 0;
	let got = words(heard);
	if (got[0] === "paper") got = got.slice(1);
	// A list item ("6. The Recorders"): the model can hear its number alone, before the pause after it.
	const listNumber = text.match(/^\s*\[?(\d+)\.\s/)?.[1];
	if (listNumber && got.length === 0 && firstNumber(heard) === listNumber) return 0;
	for (const [h, w] of SKIPS) {
		const off = close(got.slice(h), want.slice(w).join(""), h + w > 0);
		if (off !== null) return h + w + off;
	}
	return null;
}

// At an end, only words of the model are skipped, as the start of the next item.
const END_SKIPS = [0, 1, 2];

const reversed = (word: string) => [...word].reverse().join("");

/**
 * The words dropped to make the last words heard match the end of the text: null when the text has not
 * ended there. The compare of a start on the words read from the end, a little nearer. It takes a misheard
 * name, and refuses an end with a long last word still to come.
 */
export function endCost(heard: string, text: string): number | null {
	const want = words(text).reverse().map(reversed);
	if (want.length === 0) return 0;
	const got = words(heard).reverse().map(reversed);
	for (const h of END_SKIPS) {
		if (h === 0) {
			// Nearer than at a start: a misheard name passes, a last word still to come does not.
			const near = nearest(got, want.join(""));
			if (near && near.best <= Math.max(2, near.length * 0.3)) return near.best / near.length;
			continue;
		}
		const off = close(got.slice(h), want.join(""), true);
		if (off !== null) return h + off;
	}
	return null;
}

// The fewest letters to change so that the first heard words begin the text, with the letters compared.
function nearest(got: string[], want: string): { best: number; length: number } | null {
	// A short text (a list item) is compared with as much as it holds: the model also hears the next item.
	const head = got.slice(0, 4).join("").slice(0, want.length);
	if (!head) return null;
	let best = Number.POSITIVE_INFINITY;
	for (let len = Math.max(1, head.length - 3); len <= head.length + 3; len++) {
		best = Math.min(best, distance(head, want.slice(0, len)));
	}
	return { best, length: head.length };
}

// How far the heard words are from the start of the text, as a share of their letters below 1; null when too far.
function close(got: string[], want: string, strict: boolean): number | null {
	const near = nearest(got, want);
	if (!near) return null;
	const { best, length } = near;
	const off = Math.min(0.99, best / length);
	if (!strict) return best <= Math.max(2, length * 0.4) ? off : null;
	// After a skip: near for 10 letters or more, or exact for 5 or more (a short title: "Solar Density").
	return (length >= 10 ? best <= length * 0.3 : length >= 5 && best === 0) ? off : null;
}

/**
 * Hears each start, and the seconds before it. A start fits when its words match its text, and fits fully
 * when the words before it also match the end of the item before. A start that does not fit moves to the
 * nearest pause end (within `reach` seconds, after the start before it) where it fits, fully if one does.
 * A start that fits but not fully moves to a pause within 3 seconds that fits fully, if one does: the
 * model can drop the last words before a start, so the end check alone never fails an item.
 * Starts stay in order. `missed` holds the index of each item with no fit near. A start heard by ear
 * (`fixed`, index to time) is kept as it is, and no other start moves past it.
 */
const LIST_ITEM = /^\d+\.\s/;
const SAYS_NUMBER = /^\W*(number|\d)/i;

export async function repair(
	texts: string[],
	at: number[],
	pauses: Pause[],
	hear: (ats: number[], before?: boolean) => Promise<string[]>,
	reach = 20,
	fixed: Map<number, number> = new Map(),
): Promise<{ at: number[]; missed: number[]; moved: number }> {
	type Fit = { cost: number; full: boolean } | null;
	// How each time fits item i. The seconds before are heard only for the times whose start words match.
	const fits = async (i: number, ats: number[], after?: string[]): Promise<Fit[]> => {
		const said = after ?? (ats.length ? await hear(ats) : []);
		const costs = ats.map((_, n) => matchCost(said[n] ?? "", texts[i] ?? ""));
		const check = i === 0 ? [] : ats.filter((_, n) => costs[n] !== null);
		const before = check.length ? await hear(check, true) : [];
		return costs.map((cost, n) => {
			if (cost === null) return null;
			if (i === 0) return { cost, full: true };
			const end = endCost(before[check.indexOf(ats[n] ?? 0)] ?? "", texts[i - 1] ?? "");
			return { cost, full: end !== null };
		});
	};
	const heard = await hear(at);
	const marks = [...new Set([...pauses.map((p) => p.end), ...at])].sort((a, b) => a - b);
	const out = [...at];
	const missed: number[] = [];
	let moved = 0;
	for (let i = 0; i < at.length; i++) {
		const ear = fixed.get(i);
		if (ear !== undefined) {
			out[i] = ear;
			continue;
		}
		const here = at[i] ?? 0;
		const prev = i === 0 ? Number.NEGATIVE_INFINITY : (out[i - 1] ?? 0);
		// The first start heard by ear after this item: no search goes past it.
		const bound = Math.min(...[...fixed].filter(([j]) => j > i).map(([, t]) => t));
		const next = at[i + 1] ?? Number.POSITIVE_INFINITY;
		let fit: Fit =
			here > prev && here < bound ? ((await fits(i, [here], [heard[i] ?? ""]))[0] ?? null) : null;
		if (fit === null) {
			const near = marks
				.filter((t) => t > prev && t < bound && t !== here && Math.abs(t - here) <= reach)
				.sort((a, b) => Math.abs(a - here) - Math.abs(b - here));
			const all = await fits(i, near);
			let k = all.findIndex((f) => f?.full);
			if (k === -1) k = all.findIndex((f) => f !== null);
			if (k === -1) {
				missed.push(i);
				continue;
			}
			out[i] = near[k] ?? here;
			fit = all[k] ?? null;
			moved++;
		} else if (!fit.full) {
			const near = marks
				.filter((t) => t > prev && t < next && t < bound && t !== here && Math.abs(t - here) <= 3)
				.sort((a, b) => Math.abs(a - here) - Math.abs(b - here));
			const all = await fits(i, near);
			const k = all.findIndex((f) => f?.full);
			if (k !== -1) {
				out[i] = near[k] ?? here;
				fit = all[k] ?? null;
				moved++;
			}
		}
		// A match with dropped words can be a word or two late or early: a pause near it can need fewer.
		if (fit?.full && fit.cost >= 1) {
			const placed = out[i] ?? here;
			const near = marks.filter(
				(t) => t > prev && t < next && t < bound && t !== placed && Math.abs(t - placed) <= 3,
			);
			let best = fit.cost;
			(await fits(i, near)).forEach((f, n) => {
				if (f?.full && f.cost < best) {
					best = f.cost;
					out[i] = near[n] ?? placed;
				}
			});
			if (out[i] !== placed && placed === here) moved++;
		}
		// A list item ("3. ...") starts at its spoken number. The end check can take "Number three," as
		// extra words at the end of the item before, so a start just after the number also fits.
		if (LIST_ITEM.test(texts[i] ?? "")) {
			const placed = out[i] ?? here;
			const said = placed === here ? (heard[i] ?? "") : ((await hear([placed]))[0] ?? "");
			if (!SAYS_NUMBER.test(said)) {
				const near = marks
					.filter((t) => t > prev && t < placed && placed - t <= 2.5)
					.sort((a, b) => b - a);
				const heardNear = near.length ? await hear(near) : [];
				const k = heardNear.findIndex(
					(h) => SAYS_NUMBER.test(h) && matchCost(h, texts[i] ?? "") !== null,
				);
				if (k !== -1) {
					out[i] = near[k] ?? placed;
					if (placed === here) moved++;
				}
			}
		}
	}
	return { at: out, missed, moved };
}

// The starts that a person checked by ear (key to time), as item index to time.
export function earTimes(keys: string[], heard: Record<string, number>): Map<number, number> {
	const out = new Map<number, number>();
	for (const [key, time] of Object.entries(heard)) {
		const i = keys.indexOf(key);
		if (i === -1) throw new Error(`the time heard by ear for ${key}: no such item`);
		out.set(i, time);
	}
	const sorted = [...out].sort((a, b) => a[0] - b[0]);
	sorted.forEach(([i, time], n) => {
		if (n > 0 && time <= (sorted[n - 1]?.[1] ?? 0))
			throw new Error(`the time heard by ear for ${keys[i]} is out of order`);
	});
	return out;
}
