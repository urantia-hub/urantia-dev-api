// The math behind scores.ts, kept pure so it can be tested.

/** For each text, the best-match similarity of every paragraph (NaN when missing). */
export type TextScores = Record<string, Float64Array>;

export const CLOSE = 0.9; // "close" means in that text's top 10%

/**
 * Per text: regress similarity on log(paragraph length), then rank the residuals.
 * The result is a percentile in [0, 1) that length does not explain.
 */
export function adjustedPercentiles(scores: TextScores, lengths: number[]): TextScores {
	const out: TextScores = {};
	const x = lengths.map((n) => Math.log(Math.max(n, 1)));
	for (const [text, ys] of Object.entries(scores)) {
		const idx: number[] = [];
		for (let i = 0; i < ys.length; i++) if (!Number.isNaN(ys[i])) idx.push(i);
		const n = idx.length;
		const mx = idx.reduce((a, i) => a + (x[i] as number), 0) / n;
		const my = idx.reduce((a, i) => a + (ys[i] as number), 0) / n;
		let sxy = 0;
		let sxx = 0;
		for (const i of idx) {
			sxy += ((x[i] as number) - mx) * ((ys[i] as number) - my);
			sxx += ((x[i] as number) - mx) ** 2;
		}
		const slope = sxx === 0 ? 0 : sxy / sxx;
		const resid = idx.map((i) => ({
			i,
			r: (ys[i] as number) - (my + slope * ((x[i] as number) - mx)),
		}));
		resid.sort((a, b) => a.r - b.r);
		const pct = new Float64Array(ys.length).fill(Number.NaN);
		// Ties share the mean of their ranks.
		for (let k = 0; k < resid.length; ) {
			let e = k;
			while (
				e + 1 < resid.length &&
				(resid[e + 1] as { r: number }).r === (resid[k] as { r: number }).r
			)
				e++;
			const rank = (k + e) / 2 / n;
			for (let m = k; m <= e; m++) pct[(resid[m] as { i: number }).i] = rank;
			k = e + 1;
		}
		out[text] = pct;
	}
	return out;
}

export type ParagraphScore = {
	textsClose: number;
	consensus: number;
	distance: number;
	leanCorpus: string | null;
	leanGap: number | null;
	profile: Record<string, number>;
};

function argmax(i: number, texts: string[], adj: TextScores): { text: string; value: number } {
	let best = { text: "", value: -1 };
	for (const t of texts) {
		const v = (adj[t] as Float64Array)[i] as number;
		if (!Number.isNaN(v) && v > best.value) best = { text: t, value: v };
	}
	return best;
}

export function scoreParagraph(
	i: number,
	texts: string[],
	adjLarge: TextScores,
	adjSmall: TextScores,
): ParagraphScore {
	const values = texts
		.map((t) => (adjLarge[t] as Float64Array)[i] as number)
		.filter((v) => !Number.isNaN(v));
	const mean = values.reduce((a, v) => a + v, 0) / values.length;
	const top = argmax(i, texts, adjLarge);
	const topSmall = argmax(i, texts, adjSmall);
	const lean = top.value >= CLOSE && topSmall.text === top.text;
	return {
		textsClose: values.filter((v) => v >= CLOSE).length,
		consensus: mean,
		distance: 1 - top.value,
		leanCorpus: lean ? top.text : null,
		leanGap: lean ? top.value - mean : null,
		profile: Object.fromEntries(
			texts.map((t) => [t, Math.round(((adjLarge[t] as Float64Array)[i] as number) * 1000) / 1000]),
		),
	};
}

/** Pairs that are each other's best match under both models. Keys are `${paragraph}|${text}`. */
export function mutualPairs(
	ids: string[],
	texts: string[],
	largeBest: Map<string, string>,
	largeReverse: Map<string, string>,
	smallBest: Map<string, string>,
	smallReverse: Map<string, string>,
): { paragraphId: string; corpusId: string; chunkId: string }[] {
	const out: { paragraphId: string; corpusId: string; chunkId: string }[] = [];
	for (const p of ids) {
		for (const t of texts) {
			const k = largeBest.get(`${p}|${t}`);
			if (!k || largeReverse.get(k) !== p) continue;
			if (smallBest.get(`${p}|${t}`) !== k || smallReverse.get(k) !== p) continue;
			out.push({ paragraphId: p, corpusId: t, chunkId: k });
		}
	}
	return out;
}
