// Typos of a source text that its scan does not have, fixed after the parse. Each one names its passage,
// and the build fails when the typo is gone from the source, so a fix never outlives its reason.
export type SourceFix = { ref: string; from: string; to: string };

export const SOURCE_FIXES: Record<string, SourceFix[]> = {
	// Wikisource has "Fbr" for "For" in Book 8, Hymn 82; verse 28 has the same line as "For, Indra".
	"rig-veda-griffith-1896": [{ ref: "RV 8.82.29", from: "Fbr, Indra", to: "For, Indra" }],
};

export function fixSource<T extends { ref: string; text: string }>(
	corpusId: string,
	passages: T[],
): T[] {
	const fixes = SOURCE_FIXES[corpusId] ?? [];
	if (!fixes.length) return passages;
	for (const f of fixes)
		if (!passages.some((p) => p.ref === f.ref))
			throw new Error(`${corpusId}: ${f.ref} is not in the source`);
	return passages.map((p) => {
		const own = fixes.filter((f) => f.ref === p.ref);
		return own.reduce((out, f) => {
			if (!out.text.includes(f.from))
				throw new Error(`${corpusId}: ${f.ref} no longer has "${f.from}"`);
			return { ...out, text: out.text.replace(f.from, f.to) };
		}, p);
	});
}
