// Parses a scripture reference such as "2.47", "BG 2:47-49", "Dhp 183", or "25".
// "A.B" is a division and a number. A bare "A" is a verse in a one-level corpus
// (the Dhammapada) and a whole division in a two-level corpus.

export const MAX_RANGE = 50;

export type ScriptureRef =
	| { kind: "number"; start: number; end: number } // "183", "58-59"
	| { kind: "division"; division: number } // "2"
	| { kind: "unit"; division: number; start: number; end: number }; // "2.47", "2.47-49"

/** Returns null for an input that is not a reference, or a range over MAX_RANGE. */
export function parseScriptureRef(input: string, refPrefix: string): ScriptureRef | null {
	let s = input.trim().replace(/\s+/g, " ");
	if (s.toLowerCase().startsWith(refPrefix.toLowerCase())) s = s.slice(refPrefix.length).trim();
	const m = s.match(/^(\d{1,4})(?:[.:](\d{1,4}))?(?:-(\d{1,4}))?$/);
	if (!m) return null;
	const a = Number(m[1]);
	const b = m[2] === undefined ? undefined : Number(m[2]);
	const end = m[3] === undefined ? undefined : Number(m[3]);
	if (a < 1 || b === 0) return null;
	if (b === undefined) {
		const e = end ?? a;
		if (end !== undefined) {
			if (e < a || e - a >= MAX_RANGE) return null;
			return { kind: "number", start: a, end: e };
		}
		return { kind: "division", division: a };
	}
	const e = end ?? b;
	if (e < b || e - b >= MAX_RANGE) return null;
	return { kind: "unit", division: a, start: b, end: e };
}
