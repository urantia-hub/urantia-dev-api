// The nearest chunks of the other works for one chunk. Vectors are L2-normal, so cosine is a dot product.

export type Candidate = { id: string; corpus: string; v: Float32Array };
export type Near = { id: string; similarity: number };

function dot(a: Float32Array, b: Float32Array): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
	return s;
}

/** The k candidates nearest to `query`, best first, leaving out the chunks of `ownCorpus`. */
export function topOthers(
	query: Float32Array,
	candidates: Candidate[],
	ownCorpus: string,
	k: number,
): Near[] {
	const best: Near[] = [];
	for (const c of candidates) {
		if (c.corpus === ownCorpus) continue;
		const similarity = dot(query, c.v);
		if (best.length === k && similarity <= (best[k - 1] as Near).similarity) continue;
		let at = best.length;
		while (at > 0 && (best[at - 1] as Near).similarity < similarity) at--;
		best.splice(at, 0, { id: c.id, similarity });
		if (best.length > k) best.pop();
	}
	return best;
}
