// Computes paragraph_scripture_scores and scripture_mutual_pairs.
//
// For each text (the nine corpora and the Bible), a paragraph's best match is turned
// into a percentile within that text, after removing the part of the score that
// paragraph length explains (longer paragraphs score higher). Then:
// - consensus: the mean of those percentiles; texts_close counts the texts above 0.9
// - distance: 1 minus the highest percentile
// - lean: the text furthest above the paragraph's own mean, kept only when that text
//   has the paragraph above 0.9 and the small model picks the same text
// - mutual pairs: a paragraph and a chunk that are each other's best match under
//   text-embedding-3-large AND text-embedding-3-small
//
// The large model's best matches come from scripture_parallels and bible_parallels.
// The small model's are computed here, in memory.
// Run: DATABASE_URL=... bun scripts/scriptures/scores.ts
import postgres from "postgres";
import {
	adjustedPercentiles,
	mutualPairs,
	scoreParagraph,
	type TextScores,
} from "./scores-math.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(DATABASE_URL, { max: 2 });
const SMALL = 1536;

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${msg}`);

function parseVector(v: string): Float32Array {
	const parts = v.slice(1, -1).split(",");
	if (parts.length !== SMALL) throw new Error(`Vector has ${parts.length} dims`);
	const out = new Float32Array(SMALL);
	for (let i = 0; i < SMALL; i++) out[i] = Number(parts[i]);
	return out;
}

// --- Large model: best matches from the stored parallels ---
log("Loading the large model's best matches...");
const largeForward = await sql<{ p: string; c: string; k: string; s: number }[]>`
	SELECT paragraph_id AS p, corpus_id AS c, chunk_id AS k, similarity AS s
	FROM scripture_parallels WHERE direction = 'ub_to_scripture' AND rank = 1
	UNION ALL
	SELECT paragraph_id, 'bible', bible_chunk_id, similarity
	FROM bible_parallels WHERE direction = 'ub_to_bible' AND rank = 1`;
const largeReverse = await sql<{ k: string; p: string }[]>`
	SELECT chunk_id AS k, paragraph_id AS p FROM scripture_parallels WHERE direction = 'scripture_to_ub' AND rank = 1
	UNION ALL
	SELECT bible_chunk_id, paragraph_id FROM bible_parallels WHERE direction = 'bible_to_ub' AND rank = 1`;

const paragraphs = await sql<{ id: string; paper: number; n: number; v: string }[]>`
	SELECT id, paper_id::int AS paper, length(text) AS n, embedding::text AS v FROM paragraphs ORDER BY id`;
const ids = paragraphs.map((p) => p.id);
const lengths = paragraphs.map((p) => p.n);
const index = new Map(ids.map((id, i) => [id, i]));

const textIds = [...new Set(largeForward.map((r) => r.c))].sort();
const large: TextScores = Object.fromEntries(
	textIds.map((t) => [t, new Float64Array(ids.length).fill(Number.NaN)]),
);
const largeBest = new Map<string, string>(); // `${paragraph}|${text}` -> chunk
for (const r of largeForward) {
	const i = index.get(r.p);
	if (i === undefined) continue;
	(large[r.c] as Float64Array)[i] = r.s;
	largeBest.set(`${r.p}|${r.c}`, r.k);
}
const largeReverseBest = new Map(largeReverse.map((r) => [r.k, r.p]));
log(`${ids.length} paragraphs, ${textIds.length} texts`);

// --- Small model: best matches computed here ---
log("Loading the small model's vectors...");
const pv = paragraphs.map((p) => parseVector(p.v));
const chunks = [
	...(await sql<{ id: string; c: string; v: string }[]>`
		SELECT id, corpus_id AS c, embedding_small::text AS v FROM scripture_chunks WHERE embedding_small IS NOT NULL`),
	...(await sql<{ id: string; c: string; v: string }[]>`
		SELECT id, 'bible' AS c, embedding_small::text AS v FROM bible_chunks WHERE embedding_small IS NOT NULL`),
];
const cv = chunks.map((c) => parseVector(c.v));
const chunkText = chunks.map((c) => textIds.indexOf(c.c));
log(`${cv.length} chunks; computing ${ids.length} x ${cv.length} similarities`);

const small: TextScores = Object.fromEntries(
	textIds.map((t) => [t, new Float64Array(ids.length).fill(Number.NaN)]),
);
const smallBest = new Map<string, string>();
const chunkBestScore = new Float32Array(cv.length).fill(-2);
const chunkBestParagraph = new Int32Array(cv.length).fill(-1);
const rowBest = new Float64Array(textIds.length);
const rowBestChunk = new Int32Array(textIds.length);
for (let i = 0; i < pv.length; i++) {
	const a = pv[i] as Float32Array;
	rowBest.fill(-2);
	rowBestChunk.fill(-1);
	for (let j = 0; j < cv.length; j++) {
		const b = cv[j] as Float32Array;
		let s = 0;
		for (let d = 0; d < SMALL; d += 4) {
			s +=
				(a[d] as number) * (b[d] as number) +
				(a[d + 1] as number) * (b[d + 1] as number) +
				(a[d + 2] as number) * (b[d + 2] as number) +
				(a[d + 3] as number) * (b[d + 3] as number);
		}
		const t = chunkText[j] as number;
		if (s > (rowBest[t] as number)) {
			rowBest[t] = s;
			rowBestChunk[t] = j;
		}
		if (s > (chunkBestScore[j] as number)) {
			chunkBestScore[j] = s;
			chunkBestParagraph[j] = i;
		}
	}
	for (let t = 0; t < textIds.length; t++) {
		(small[textIds[t] as string] as Float64Array)[i] = rowBest[t] as number;
		smallBest.set(
			`${ids[i]}|${textIds[t]}`,
			(chunks[rowBestChunk[t] as number] as { id: string }).id,
		);
	}
	if ((i + 1) % 1000 === 0) log(`  ${i + 1} / ${pv.length}`);
}
const smallReverseBest = new Map(
	chunks.map((c, j) => [c.id, ids[chunkBestParagraph[j] as number] as string]),
);

// --- Scores ---
log("Scoring...");
const adjLarge = adjustedPercentiles(large, lengths);
const adjSmall = adjustedPercentiles(small, lengths);
const scoreRows = ids.map((id, i) => {
	const s = scoreParagraph(i, textIds, adjLarge, adjSmall);
	return {
		paragraph_id: id,
		texts_close: s.textsClose,
		consensus: s.consensus,
		distance: s.distance,
		lean_corpus: s.leanCorpus,
		lean_gap: s.leanGap,
		profile: sql.json(s.profile),
	};
});

const smallSim = (p: string, t: string) =>
	(small[t] as Float64Array)[index.get(p) as number] as number;
const pairs = mutualPairs(
	ids,
	textIds,
	largeBest,
	largeReverseBest,
	smallBest,
	smallReverseBest,
).map((p) => ({
	paragraph_id: p.paragraphId,
	corpus_id: p.corpusId,
	chunk_id: p.chunkId,
	similarity: (large[p.corpusId] as Float64Array)[index.get(p.paragraphId) as number] as number,
	similarity_small: smallSim(p.paragraphId, p.corpusId),
}));

log(`Writing ${scoreRows.length} scores and ${pairs.length} mutual pairs...`);
await sql.begin(async (tx) => {
	await tx`DELETE FROM scripture_mutual_pairs`;
	await tx`DELETE FROM paragraph_scripture_scores`;
	for (let i = 0; i < scoreRows.length; i += 1000) {
		await tx`INSERT INTO paragraph_scripture_scores ${tx(scoreRows.slice(i, i + 1000))}`;
	}
	for (let i = 0; i < pairs.length; i += 1000) {
		await tx`INSERT INTO scripture_mutual_pairs ${tx(pairs.slice(i, i + 1000))}`;
	}
});
const leans = scoreRows.filter((r) => r.lean_corpus).length;
log(`Done: ${leans} stable leans, ${pairs.length} stable mutual pairs`);
console.table(
	await sql`SELECT corpus_id, count(*)::int AS pairs FROM scripture_mutual_pairs GROUP BY 1 ORDER BY 2 DESC`,
);
await sql.end();
