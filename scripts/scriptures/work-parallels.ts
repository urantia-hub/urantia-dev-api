// Computes scripture_work_parallels in memory: for each chunk of a work, the 10 nearest chunks of the
// other works and of the Bible (text-embedding-3-large, so cosine is a dot product).
// DRY=1 writes a sample of 30 chunks to OUT (default work-parallels-sample.json) and no rows.
// Without it, one transaction replaces every row.
// Run: DATABASE_URL=... [DRY=1] bun scripts/scriptures/work-parallels.ts
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { type Candidate, topOthers } from "./work-top.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const DRY = process.env.DRY === "1";
const sql = postgres(DATABASE_URL, { max: 2 });

const DIMS = 3072;
const TOP = 10;
const PAGE = 1000;
const SAMPLE = 30;
const BIBLE = "bible";

function parseVector(v: string): Float32Array {
	const parts = v.slice(1, -1).split(",");
	if (parts.length !== DIMS) throw new Error(`Vector has ${parts.length} dims`);
	const out = new Float32Array(DIMS);
	for (let i = 0; i < DIMS; i++) out[i] = Number(parts[i]);
	return out;
}

type Loaded = Candidate & { bible: boolean; label: string; text: string };

/** Reads the vectors of one table in pages of PAGE rows, by id. */
async function load(table: "scripture_chunks" | "bible_chunks"): Promise<Loaded[]> {
	const out: Loaded[] = [];
	let after = "";
	for (;;) {
		const rows =
			table === "scripture_chunks"
				? await sql<{ id: string; corpus: string; label: string; text: string; v: string }[]>`
					SELECT id, corpus_id AS corpus, label, text, embedding::text AS v FROM scripture_chunks
					WHERE embedding IS NOT NULL AND id > ${after} ORDER BY id LIMIT ${PAGE}`
				: await sql<{ id: string; corpus: string; label: string; text: string; v: string }[]>`
					SELECT id, ${BIBLE} AS corpus, id AS label, text, embedding::text AS v FROM bible_chunks
					WHERE embedding IS NOT NULL AND id > ${after} ORDER BY id LIMIT ${PAGE}`;
		if (rows.length === 0) return out;
		for (const r of rows)
			out.push({
				id: r.id,
				corpus: r.corpus,
				label: r.label,
				text: r.text,
				v: parseVector(r.v),
				bible: table === "bible_chunks",
			});
		after = (rows[rows.length - 1] as { id: string }).id;
		console.log(`  ${table}: ${out.length}`);
	}
}

const missing = await sql<
	{ n: number }[]
>`SELECT count(*)::int AS n FROM scripture_chunks WHERE embedding IS NULL`;
if ((missing[0]?.n ?? 0) > 0)
	throw new Error(`${missing[0]?.n} chunks have no embedding; run embed.ts`);
console.log("Loading vectors...");
const works = await load("scripture_chunks");
const bible = await load("bible_chunks");
const all = [...works, ...bible];
const byId = new Map(all.map((c) => [c.id, c]));
console.log(`${works.length} work chunks x ${all.length} candidates`);

if (DRY) {
	// Chunks spread over the works: every n-th chunk in id order, so each work gives about its share.
	const step = Math.max(1, Math.floor(works.length / SAMPLE));
	const picked = works.filter((_, i) => i % step === 0).slice(0, SAMPLE);
	const sample = picked.map((c) => ({
		chunk: { id: c.id, label: c.label, text: c.text },
		near: topOthers(c.v, all, c.corpus, TOP).map((n) => {
			const o = byId.get(n.id) as Loaded;
			return {
				id: o.id,
				work: o.corpus,
				label: o.label,
				similarity: Number(n.similarity.toFixed(4)),
				text: o.text,
			};
		}),
	}));
	const out = process.env.OUT ?? "work-parallels-sample.json";
	writeFileSync(out, JSON.stringify(sample, null, 2));
	console.log(`Wrote ${sample.length} samples to ${out}`);
	await sql.end();
	process.exit(0);
}

type Row = {
	chunk_id: string;
	rank: number;
	other_chunk_id: string | null;
	other_bible_chunk_id: string | null;
	similarity: number;
};
const rows: Row[] = [];
for (const [i, c] of works.entries()) {
	for (const [r, n] of topOthers(c.v, all, c.corpus, TOP).entries()) {
		const bibleHit = (byId.get(n.id) as Loaded).bible;
		rows.push({
			chunk_id: c.id,
			rank: r + 1,
			other_chunk_id: bibleHit ? null : n.id,
			other_bible_chunk_id: bibleHit ? n.id : null,
			similarity: n.similarity,
		});
	}
	if ((i + 1) % 2000 === 0) console.log(`  ${i + 1} / ${works.length}`);
}

console.log(`Writing ${rows.length} rows...`);
await sql.begin(async (tx) => {
	await tx`DELETE FROM scripture_work_parallels`;
	for (let i = 0; i < rows.length; i += 2000)
		await tx`INSERT INTO scripture_work_parallels ${tx(rows.slice(i, i + 2000))}`;
});
const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM scripture_work_parallels`;
console.log(`${count?.n} rows`);
await sql.end();
