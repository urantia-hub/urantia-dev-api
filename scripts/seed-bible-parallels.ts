// Phase 3: pre-compute top-10 nearest neighbors in both directions between
// Urantia paragraphs and Bible chunks. Stores results in `bible_parallels`.
//
// Strategy: pull both corpora's embeddings into memory and compute cosine
// similarities in a tight loop. We tried doing this in pgvector but at
// 3072-d each per-paragraph query takes ~3s of DB CPU, which makes the
// full job ~12 hours. In-memory takes ~30-60 minutes.
//
// Why in-memory works: the vectors are pre-normalized by OpenAI (L2=1), so
// cosine similarity collapses to a plain dot product. The total RAM
// footprint is ~400 MB of Float32 vectors. Bun handles it comfortably.
//
// Why we don't use HNSW: pgvector's HNSW index is capped at 2000
// dimensions for the regular `vector` type, and we're at 3072. Sequential
// scan is the only option in DB, and JS dot products turn out to be
// faster than DB sequential scan because of JIT + tight memory layout.
//
// ON CONFLICT DO UPDATE handles re-runs after a model upgrade cleanly.
//
// Usage:
//   DATABASE_URL=... bun run scripts/seed-bible-parallels.ts
//
// Optional env:
//   PHASE=ub      only compute UB → Bible
//   PHASE=bible   only compute Bible → UB
//   PHASE=all     default

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL is required");
	process.exit(1);
}

const PHASE = process.env.PHASE ?? "all";
const TOP_N = 10;
const EMBEDDING_MODEL = "text-embedding-3-large";
const DIMS = 3072;

const client = postgres(DATABASE_URL, { max: 5 });
const db = drizzle(client);

// pgvector returns a vector as a string like "[0.123,0.456,...]". Parse.
function parseVector(v: unknown): Float32Array {
	if (typeof v !== "string") {
		throw new Error(`Expected vector as string, got ${typeof v}`);
	}
	const inner = v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1) : v;
	const parts = inner.split(",");
	if (parts.length !== DIMS) {
		throw new Error(`Vector has ${parts.length} dims, expected ${DIMS}`);
	}
	const arr = new Float32Array(DIMS);
	for (let i = 0; i < DIMS; i++) arr[i] = Number(parts[i]);
	return arr;
}

// Dot product of two equal-length Float32Arrays. Inlined hot loop.
function dot(a: Float32Array, b: Float32Array): number {
	let s = 0;
	const n = a.length;
	for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
	return s;
}

// Find the indices of the top-N largest similarities. Returns
// [{ index, score }, ...] sorted by score DESC.
function topN(scores: Float32Array, n: number): { index: number; score: number }[] {
	const heap: { index: number; score: number }[] = [];
	for (let i = 0; i < scores.length; i++) {
		const s = scores[i]!;
		if (heap.length < n) {
			heap.push({ index: i, score: s });
			heap.sort((a, b) => a.score - b.score);
		} else if (s > heap[0]!.score) {
			heap[0] = { index: i, score: s };
			heap.sort((a, b) => a.score - b.score);
		}
	}
	return heap.reverse();
}

async function fetchEmbeddings(
	tableName: "paragraphs" | "bible_chunks",
	column: "embedding" | "embedding_v2",
): Promise<{ ids: string[]; vectors: Float32Array[] }> {
	console.log(`  Pulling ${tableName}.${column} into memory...`);
	const rows = (tableName === "paragraphs"
		? await db.execute(sql<{ id: string; v: unknown }[]>`
				SELECT id, ${sql.identifier(column)}::text AS v
				FROM paragraphs
				WHERE ${sql.identifier(column)} IS NOT NULL
				ORDER BY id
		  `)
		: await db.execute(sql<{ id: string; v: unknown }[]>`
				SELECT id, ${sql.identifier(column)}::text AS v
				FROM bible_chunks
				WHERE ${sql.identifier(column)} IS NOT NULL
				ORDER BY id
		  `)) as unknown as { id: string; v: unknown }[];

	const ids: string[] = [];
	const vectors: Float32Array[] = [];
	for (const r of rows) {
		ids.push(r.id);
		vectors.push(parseVector(r.v));
	}
	console.log(`  Loaded ${ids.length} vectors (${(ids.length * DIMS * 4 / 1024 / 1024).toFixed(0)} MB)`);
	return { ids, vectors };
}

async function bulkInsertParallels(
	rows: {
		direction: "ub_to_bible" | "bible_to_ub";
		paragraphId: string;
		bibleChunkId: string;
		similarity: number;
		rank: number;
	}[],
) {
	for (let i = 0; i < rows.length; i += 1000) {
		const batch = rows.slice(i, i + 1000);
		const valuesSql = sql.join(
			batch.map(
				(r) => sql`(
					${r.direction},
					${r.paragraphId},
					${r.bibleChunkId},
					${r.similarity}::real,
					${r.rank}::int,
					'semantic',
					${EMBEDDING_MODEL}
				)`,
			),
			sql`, `,
		);
		await db.execute(sql`
			INSERT INTO bible_parallels (
				direction, paragraph_id, bible_chunk_id, similarity, rank, source, embedding_model
			)
			VALUES ${valuesSql}
			ON CONFLICT (direction, paragraph_id, bible_chunk_id, source) DO UPDATE
			SET similarity      = EXCLUDED.similarity,
			    rank            = EXCLUDED.rank,
			    embedding_model = EXCLUDED.embedding_model,
			    generated_at    = NOW()
		`);
	}
}

async function computeUbToBible() {
	console.log("\n=== Phase 3a — UB → Bible top 10 ===");
	const start = Date.now();

	const ub = await fetchEmbeddings("paragraphs", "embedding_v2");
	const bible = await fetchEmbeddings("bible_chunks", "embedding");

	console.log(`  Computing ${ub.ids.length} × ${bible.ids.length} similarities...`);
	const scores = new Float32Array(bible.ids.length);
	const allParallels: Parameters<typeof bulkInsertParallels>[0] = [];

	for (let i = 0; i < ub.ids.length; i++) {
		const ubVec = ub.vectors[i]!;
		for (let j = 0; j < bible.vectors.length; j++) {
			scores[j] = dot(ubVec, bible.vectors[j]!);
		}
		const top = topN(scores, TOP_N);
		const ubId = ub.ids[i]!;
		for (let r = 0; r < top.length; r++) {
			const { index, score } = top[r]!;
			allParallels.push({
				direction: "ub_to_bible",
				paragraphId: ubId,
				bibleChunkId: bible.ids[index]!,
				similarity: score,
				rank: r + 1,
			});
		}
		if ((i + 1) % 500 === 0 || i + 1 === ub.ids.length) {
			console.log(`  computed ${i + 1} / ${ub.ids.length}`);
		}
	}

	console.log(`  Inserting ${allParallels.length} rows...`);
	await bulkInsertParallels(allParallels);

	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`  Done in ${elapsed}s`);
}

async function computeBibleToUb() {
	console.log("\n=== Phase 3b — Bible → UB top 10 ===");
	const start = Date.now();

	const bible = await fetchEmbeddings("bible_chunks", "embedding");
	const ub = await fetchEmbeddings("paragraphs", "embedding_v2");

	console.log(`  Computing ${bible.ids.length} × ${ub.ids.length} similarities...`);
	const scores = new Float32Array(ub.ids.length);
	const allParallels: Parameters<typeof bulkInsertParallels>[0] = [];

	for (let i = 0; i < bible.ids.length; i++) {
		const bibleVec = bible.vectors[i]!;
		for (let j = 0; j < ub.vectors.length; j++) {
			scores[j] = dot(bibleVec, ub.vectors[j]!);
		}
		const top = topN(scores, TOP_N);
		const bibleId = bible.ids[i]!;
		for (let r = 0; r < top.length; r++) {
			const { index, score } = top[r]!;
			allParallels.push({
				direction: "bible_to_ub",
				paragraphId: ub.ids[index]!,
				bibleChunkId: bibleId,
				similarity: score,
				rank: r + 1,
			});
		}
		if ((i + 1) % 500 === 0 || i + 1 === bible.ids.length) {
			console.log(`  computed ${i + 1} / ${bible.ids.length}`);
		}
	}

	console.log(`  Inserting ${allParallels.length} rows...`);
	await bulkInsertParallels(allParallels);

	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`  Done in ${elapsed}s`);
}

async function main() {
	if (PHASE === "all" || PHASE === "ub") await computeUbToBible();
	if (PHASE === "all" || PHASE === "bible") await computeBibleToUb();

	const summary = await db.execute(sql<{ direction: string; n: number }[]>`
		SELECT direction, COUNT(*)::int AS n FROM bible_parallels GROUP BY direction
	`);
	console.log("\nFinal counts:");
	for (const row of summary as unknown as { direction: string; n: number }[]) {
		console.log(`  ${row.direction}: ${row.n}`);
	}

	await client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
