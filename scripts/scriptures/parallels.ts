// Computes scripture_parallels in memory, as seed-bible-parallels.ts does:
// - ub_to_scripture: for each Urantia paragraph, the top 3 chunks of each corpus
// - scripture_to_ub: for each chunk, the top 10 Urantia paragraphs
// Vectors are text-embedding-3-large (L2 = 1), so cosine is a dot product.
// It replaces every "semantic" row in one transaction.
// Run: DATABASE_URL=... bun scripts/scriptures/parallels.ts
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(DATABASE_URL, { max: 2 });

const DIMS = 3072;
const PER_CORPUS = 3;
const TO_UB = 10;
const MODEL = "text-embedding-3-large";

function parseVector(v: string): Float32Array {
	const parts = v.slice(1, -1).split(",");
	if (parts.length !== DIMS) throw new Error(`Vector has ${parts.length} dims`);
	const out = new Float32Array(DIMS);
	for (let i = 0; i < DIMS; i++) out[i] = Number(parts[i]);
	return out;
}

function dot(a: Float32Array, b: Float32Array): number {
	let s = 0;
	for (let i = 0; i < DIMS; i++) s += (a[i] as number) * (b[i] as number);
	return s;
}

/** Indices of the n highest scores among `candidates`, best first. */
function top(scores: Float32Array, candidates: number[], n: number): number[] {
	return [...candidates].sort((a, b) => (scores[b] as number) - (scores[a] as number)).slice(0, n);
}

console.log("Loading vectors...");
const paras = await sql<{ id: string; v: string }[]>`
	SELECT id, embedding_v2::text AS v FROM paragraphs WHERE embedding_v2 IS NOT NULL ORDER BY id`;
const chunks = await sql<{ id: string; corpus_id: string; v: string }[]>`
	SELECT id, corpus_id, embedding::text AS v FROM scripture_chunks WHERE embedding IS NOT NULL ORDER BY id`;
const missing = await sql<{ n: number }[]>`
	SELECT count(*)::int AS n FROM scripture_chunks WHERE embedding IS NULL`;
if ((missing[0]?.n ?? 0) > 0)
	throw new Error(`${missing[0]?.n} chunks have no embedding; run embed.ts`);
const pv = paras.map((p) => parseVector(p.v));
const cv = chunks.map((c) => parseVector(c.v));
console.log(`${pv.length} paragraphs x ${cv.length} chunks`);

const byCorpus = new Map<string, number[]>();
for (const [j, c] of chunks.entries()) {
	byCorpus.set(c.corpus_id, [...(byCorpus.get(c.corpus_id) ?? []), j]);
}

type Row = {
	direction: string;
	paragraph_id: string;
	chunk_id: string;
	corpus_id: string;
	similarity: number;
	rank: number;
	source: string;
	embedding_model: string;
};
const rows: Row[] = [];
const toUb = cv.map(() => new Float32Array(pv.length));
const scores = new Float32Array(cv.length);
for (const [i, p] of pv.entries()) {
	for (let j = 0; j < cv.length; j++) {
		const s = dot(p, cv[j] as Float32Array);
		scores[j] = s;
		(toUb[j] as Float32Array)[i] = s;
	}
	for (const [corpusId, idx] of byCorpus) {
		for (const [r, j] of top(scores, idx, PER_CORPUS).entries()) {
			rows.push({
				direction: "ub_to_scripture",
				paragraph_id: (paras[i] as { id: string }).id,
				chunk_id: (chunks[j] as { id: string }).id,
				corpus_id: corpusId,
				similarity: scores[j] as number,
				rank: r + 1,
				source: "semantic",
				embedding_model: MODEL,
			});
		}
	}
	if ((i + 1) % 2000 === 0) console.log(`  ${i + 1} / ${pv.length}`);
}
const allParas = pv.map((_, i) => i);
for (const [j, c] of chunks.entries()) {
	const s = toUb[j] as Float32Array;
	for (const [r, i] of top(s, allParas, TO_UB).entries()) {
		rows.push({
			direction: "scripture_to_ub",
			paragraph_id: (paras[i] as { id: string }).id,
			chunk_id: c.id,
			corpus_id: c.corpus_id,
			similarity: s[i] as number,
			rank: r + 1,
			source: "semantic",
			embedding_model: MODEL,
		});
	}
}

console.log(`Writing ${rows.length} rows...`);
await sql.begin(async (tx) => {
	await tx`DELETE FROM scripture_parallels WHERE source = 'semantic'`;
	for (let i = 0; i < rows.length; i += 2000) {
		await tx`INSERT INTO scripture_parallels ${tx(rows.slice(i, i + 2000))}`;
	}
});
const counts = await sql`
	SELECT direction, corpus_id, count(*)::int AS n FROM scripture_parallels
	GROUP BY 1, 2 ORDER BY 1, 2`;
console.table(counts);
await sql.end();
