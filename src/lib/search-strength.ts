// How close a semantic result is, in words a reader can use. The cut points come from
// `bun scripts/calibrate-strength.ts` (30 paraphrases of known paragraphs, live API, 2026-10-18):
// strong = the 25th percentile of right answers at rank 1, related = the 10th percentile of right
// answers in the top 10. Run it again after a change of the embedding model.
export type Strength = "strong" | "related" | "weak";
export type Body = "papers" | "bible" | "works";

export const CUTS: Record<Body, { strong: number; related: number }> = {
	papers: { strong: 0.66, related: 0.595 },
	// Not measured yet; the Papers values until the works are calibrated.
	bible: { strong: 0.66, related: 0.595 },
	works: { strong: 0.66, related: 0.595 },
};

export function strengthOf(similarity: number, body: Body): Strength {
	const cut = CUTS[body];
	if (similarity >= cut.strong) return "strong";
	if (similarity >= cut.related) return "related";
	return "weak";
}
