// Checks each placed start against the words a speech model hears there, and moves a start that is off.
// Pure: the speech model comes in as `hear` (scripts/audio-timing/hear.py in the real run).
import type { Pause } from "./place";

// Numbers are left out on both sides: the model writes "31" for "thirty-one" and says "number one" for "1.".
const NUMBER =
	/^(\d+(st|nd|rd|th)?|number|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)$/;

function words(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !NUMBER.test(w));
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

// How far the heard words are from the start of the text, as a share of their letters below 1; null when too far.
function close(got: string[], want: string, strict: boolean): number | null {
	// A short text (a list item) is compared with as much as it holds: the model also hears the next item.
	const head = got.slice(0, 4).join("").slice(0, want.length);
	if (!head) return null;
	let best = Number.POSITIVE_INFINITY;
	for (let len = Math.max(1, head.length - 3); len <= head.length + 3; len++) {
		best = Math.min(best, distance(head, want.slice(0, len)));
	}
	const off = Math.min(0.99, best / head.length);
	if (!strict) return best <= Math.max(2, head.length * 0.4) ? off : null;
	// After a skip: near for 10 letters or more, or exact for 5 or more (a short title: "Solar Density").
	return (head.length >= 10 ? best <= head.length * 0.3 : head.length >= 5 && best === 0)
		? off
		: null;
}

/**
 * Hears each start. A start whose words do not match its text moves to the nearest pause end
 * (within `reach` seconds, after the start before it) where they do. Starts stay in order.
 * `missed` holds the index of each item with no match near.
 */
export async function repair(
	texts: string[],
	at: number[],
	pauses: Pause[],
	hear: (ats: number[]) => Promise<string[]>,
	reach = 20,
): Promise<{ at: number[]; missed: number[]; moved: number }> {
	const heard = await hear(at);
	const marks = [...new Set([...pauses.map((p) => p.end), ...at])].sort((a, b) => a - b);
	const out = [...at];
	const missed: number[] = [];
	let moved = 0;
	for (let i = 0; i < at.length; i++) {
		const here = at[i] ?? 0;
		const prev = i === 0 ? Number.NEGATIVE_INFINITY : (out[i - 1] ?? 0);
		const text = texts[i] ?? "";
		let cost = here > prev ? matchCost(heard[i] ?? "", text) : null;
		if (cost === null) {
			const near = marks
				.filter((t) => t > prev && t !== here && Math.abs(t - here) <= reach)
				.sort((a, b) => Math.abs(a - here) - Math.abs(b - here));
			const said = near.length ? await hear(near) : [];
			const k = said.findIndex((w) => heardMatches(w, text));
			if (k === -1) {
				missed.push(i);
				continue;
			}
			out[i] = near[k] ?? here;
			cost = matchCost(said[k] ?? "", text);
			moved++;
		}
		// A match with dropped words can be a word or two late or early: a pause near it can need fewer.
		if (cost !== null && cost >= 1) {
			const placed = out[i] ?? here;
			const next = at[i + 1] ?? Number.POSITIVE_INFINITY;
			const near = marks.filter(
				(t) => t > prev && t < next && t !== placed && Math.abs(t - placed) <= 3,
			);
			const said = near.length ? await hear(near) : [];
			let best = cost;
			said.forEach((w, k) => {
				const c = matchCost(w, text);
				if (c !== null && c < best) {
					best = c;
					out[i] = near[k] ?? placed;
				}
			});
			if (out[i] !== placed && out[i] !== here) moved++;
		}
	}
	return { at: out, missed, moved };
}
