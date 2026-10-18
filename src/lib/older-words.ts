// Modern words and the older words that the Papers use for them, so "pigs" also finds "swine".
// Each pair is approved by Kelson. Keys and values are normalized words (`normalizeQuery`).
export const OLDER_WORDS: Readonly<Record<string, readonly string[]>> = {
	pig: ["swine"],
	pigs: ["swine"],
	hog: ["swine"],
	hogs: ["swine"],
};

// The most phrases that the exact tier tries, so a query full of listed words stays cheap.
const MAX_PHRASES = 8;

/** The older words of a query's words, in order, with no repeat and none of the words themselves. */
export function olderWords(words: string[]): string[] {
	const out = new Set<string>();
	for (const w of words) for (const o of OLDER_WORDS[w] ?? []) if (!words.includes(o)) out.add(o);
	return [...out];
}

/** The phrase, and the same phrase with listed words swapped for their older words. */
export function phraseVariants(words: string[]): string[] {
	let phrases: string[][] = [[]];
	for (const w of words) {
		const choices = [w, ...(OLDER_WORDS[w] ?? [])];
		phrases = phrases.flatMap((p) => choices.map((c) => [...p, c])).slice(0, MAX_PHRASES);
	}
	return phrases.map((p) => p.join(" "));
}

/** A tsquery like `toTsQuery`, where each listed word also matches its older words: `(pigs:* | swine)`. */
export function olderTsQuery(words: string[], join: "&" | "|", prefixLast: boolean): string {
	return words
		.map((w, i) => {
			const term = prefixLast && i === words.length - 1 ? `${w}:*` : w;
			const older = (OLDER_WORDS[w] ?? []).filter((o) => !words.includes(o));
			return older.length > 0 ? `(${[term, ...older].join(" | ")})` : term;
		})
		.join(` ${join} `);
}
