// Parses a scripture reference such as "2.47", "BG 2:47-49", "Dhp 183", or "3.22.5".
// `levels` is how many numbers a full ref has in this corpus: 1 for "Dhp 183",
// 2 for "BG 2.47", 3 for "Epictetus 3.22.5". A shorter ref names a whole part:
// "BG 2" is chapter 2, and "Epictetus 3.22" is chapter 22 of book 3.

export const MAX_RANGE = 50;

export type ScriptureRef = {
	path: number[]; // 1 to `levels` numbers, outermost first
	end: number; // the last number of a range on the final level; equals the final number otherwise
	full: boolean; // true when the ref names passages, false when it names a whole part
};

/** Returns null for an input that is not a reference, or a range over MAX_RANGE. */
export function parseScriptureRef(
	input: string,
	refPrefix: string,
	levels: number,
): ScriptureRef | null {
	let s = input.trim().replace(/\s+/g, " ");
	if (s.toLowerCase().startsWith(refPrefix.toLowerCase())) s = s.slice(refPrefix.length).trim();
	const m = s.match(/^(\d{1,4}(?:[.:]\d{1,4}){0,2})(?:-(\d{1,4}))?$/);
	if (!m) return null;
	const path = (m[1] as string).split(/[.:]/).map(Number);
	if (path.length > levels) return null;
	const full = path.length === levels;
	const last = path[path.length - 1] as number;
	if (m[2] === undefined) return { path, end: last, full };
	const end = Number(m[2]);
	// A range is allowed only on the final level: "2.47-49", not "2-3".
	if (!full || end < last || end - last >= MAX_RANGE) return null;
	return { path, end, full };
}
