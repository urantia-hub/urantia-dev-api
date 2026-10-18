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

// Lower case with no accents, so "Völuspá" and "voluspa" compare equal.
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * The index (1-based) of the division that `s` starts with, and the rest of `s`. A name matches as a
 * whole word: a listed name, an alias, or a short form of 2 or more letters that starts one name only.
 */
function divisionName(
	s: string,
	names: string[],
	aliases: Record<string, number>,
): { index: number; rest: string } | null {
	const m = fold(s).match(/^(.*?[a-z].*?)\s+(\d.*)$/);
	if (!m) return null;
	const [, word, rest] = m as unknown as [string, string, string];
	// An entry can hold other spellings after a bar: "Voluspo|Voluspa".
	const spellings = names.map((n) => n.split("|").map(fold));
	const full = spellings.findIndex((all) => all.includes(word));
	if (full >= 0) return { index: full + 1, rest };
	if (aliases[word]) return { index: aliases[word] as number, rest };
	if (word.replace(/[^a-z]/g, "").length < 2) return null;
	const starts = spellings.flatMap((all, i) =>
		all.some((n) => n.startsWith(word)) ? [i + 1] : [],
	);
	return starts.length === 1 ? { index: starts[0] as number, rest } : null;
}

/** True when the input starts with a full division name (or a listed spelling) and a number. */
export function namesDivision(input: string, names?: string[] | null): boolean {
	const m = fold(input.trim().replace(/\s+/g, " ")).match(/^(.*?[a-z].*?)\s+\d/);
	return (
		!!m &&
		!!names?.some((n) =>
			n
				.split("|")
				.map(fold)
				.includes(m[1] as string),
		)
	);
}

/** Returns null for an input that is not a reference, or a range over MAX_RANGE. */
export function parseScriptureRef(
	input: string,
	refPrefix: string,
	levels: number,
	divisionNames?: string[] | null,
	aliases: Record<string, number> = {},
): ScriptureRef | null {
	let s = input.trim().replace(/\s+/g, " ");
	if (s.toLowerCase().startsWith(refPrefix.toLowerCase())) s = s.slice(refPrefix.length).trim();
	// "1 Nephi 3:7" reads as "1.3.7": the name stands for its division number.
	if (divisionNames?.length && /[^\d.:\s-]/.test(s)) {
		const named = divisionName(s, divisionNames, aliases);
		if (!named) return null;
		s = `${named.index}.${named.rest}`;
	}
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
