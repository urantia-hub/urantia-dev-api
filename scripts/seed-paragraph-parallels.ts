// Pre-compute UB↔UB top-10 nearest neighbors per paragraph using
// text-embedding-3-large (3072-d). Mirrors scripts/seed-bible-parallels.ts
// but with one corpus on both sides.
//
// Self-similarity is excluded — we want the top-10 OTHER paragraphs.
//
// Usage:
//   DATABASE_URL=... bun run scripts/seed-paragraph-parallels.ts

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL is required");
	process.exit(1);
}

const TOP_N = 10;
const EMBEDDING_MODEL = "text-embedding-3-large";
const DIMS = 3072;

const client = postgres(DATABASE_URL, { max: 5 });
const db = drizzle(client);

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

function dot(a: Float32Array, b: Float32Array): number {
	let s = 0;
	const n = a.length;
	for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
	return s;
}

// Heap-based top-N. Returns indices/scores sorted by score DESC.
// `excludeIndex` is filtered out so a paragraph never neighbors itself.
function topN(
	scores: Float32Array,
	n: number,
	excludeIndex: number,
): { index: number; score: number }[] {
	const heap: { index: number; score: number }[] = [];
	for (let i = 0; i < scores.length; i++) {
		if (i === excludeIndex) continue;
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

async function fetchParagraphEmbeddings(): Promise<{ ids: string[]; vectors: Float32Array[] }> {
	console.log("  Pulling paragraphs.embedding_v2 into memory...");
	const rows = (await db.execute(sql<{ id: string; v: unknown }[]>`
		SELECT id, embedding_v2::text AS v
		FROM paragraphs
		WHERE embedding_v2 IS NOT NULL
		ORDER BY id
	`)) as unknown as { id: string; v: unknown }[];

	const ids: string[] = [];
	const vectors: Float32Array[] = [];
	for (const r of rows) {
		ids.push(r.id);
		vectors.push(parseVector(r.v));
	}
	console.log(
		`  Loaded ${ids.length} vectors (${(
			(ids.length * DIMS * 4) /
			1024 /
			1024
		).toFixed(0)} MB)`,
	);
	return { ids, vectors };
}

type ParallelRow = {
	sourceParagraphId: string;
	targetParagraphId: string;
	similarity: number;
	rank: number;
};

async function bulkInsert(rows: ParallelRow[]) {
	for (let i = 0; i < rows.length; i += 1000) {
		const batch = rows.slice(i, i + 1000);
		const valuesSql = sql.join(
			batch.map(
				(r) => sql`(
					${r.sourceParagraphId},
					${r.targetParagraphId},
					${r.similarity}::real,
					${r.rank}::int,
					${EMBEDDING_MODEL}
				)`,
			),
			sql`, `,
		);
		await db.execute(sql`
			INSERT INTO paragraph_parallels (
				source_paragraph_id, target_paragraph_id, similarity, rank, embedding_model
			)
			VALUES ${valuesSql}
			ON CONFLICT (source_paragraph_id, target_paragraph_id) DO UPDATE
			SET similarity      = EXCLUDED.similarity,
			    rank            = EXCLUDED.rank,
			    embedding_model = EXCLUDED.embedding_model,
			    generated_at    = NOW()
		`);
		const end = Math.min(i + 1000, rows.length);
		console.log(`  Inserted ${end} / ${rows.length}`);
	}
}

async function main() {
	const start = Date.now();

	const { ids, vectors } = await fetchParagraphEmbeddings();
	console.log(`  Computing ${ids.length} × ${ids.length} similarities (excluding self)...`);

	const scores = new Float32Array(ids.length);
	const allParallels: ParallelRow[] = [];

	for (let i = 0; i < ids.length; i++) {
		const sourceVec = vectors[i]!;
		for (let j = 0; j < vectors.length; j++) {
			scores[j] = dot(sourceVec, vectors[j]!);
		}
		const top = topN(scores, TOP_N, i);
		const sourceId = ids[i]!;
		for (let r = 0; r < top.length; r++) {
			const { index, score } = top[r]!;
			allParallels.push({
				sourceParagraphId: sourceId,
				targetParagraphId: ids[index]!,
				similarity: score,
				rank: r + 1,
			});
		}
		if ((i + 1) % 500 === 0 || i + 1 === ids.length) {
			console.log(`  computed ${i + 1} / ${ids.length}`);
		}
	}

	console.log(`  Inserting ${allParallels.length} rows...`);
	await bulkInsert(allParallels);

	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`\nTotal wall-clock: ${elapsed}s`);

	const summary = await db.execute(sql<{ n: number }[]>`
		SELECT COUNT(*)::int AS n FROM paragraph_parallels
	`);
	const total = (summary as unknown as { n: number }[])[0]?.n ?? 0;
	console.log(`paragraph_parallels rows: ${total}`);

	await client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
