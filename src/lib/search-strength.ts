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

// A Spanish query lands 0.09 lower than its English twin at each rank (`bun scripts/measure-semantic-es.ts`,
// 30 pairs, 2026-10-23), so its similarity is raised by that much before the cut points.
export const ES_STRENGTH_OFFSET = 0.09;

export function strengthOf(similarity: number, body: Body, lang: "eng" | "es" = "eng"): Strength {
	const cut = CUTS[body];
	const s = lang === "es" ? similarity + ES_STRENGTH_OFFSET : similarity;
	if (s >= cut.strong) return "strong";
	if (s >= cut.related) return "related";
	return "weak";
}
