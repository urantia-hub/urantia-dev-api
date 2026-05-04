// Embed bible_chunks with text-embedding-3-small (1536-d) for the live
// Bible semantic search endpoint. The 3-large 3072-d embeddings already
// in `bible_chunks.embedding` are kept for the pre-computed
// cross-reference tables; HNSW can't index them (pgvector caps at 2000 dims).
//
// Usage:
//   DATABASE_URL=... OPENAI_API_KEY=... bun run scripts/embed-bible-small.ts
//
// Re-runnable: only embeds rows where embedding_small IS NULL.

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!DATABASE_URL) {
	console.error("DATABASE_URL is required");
	process.exit(1);
}
if (!OPENAI_API_KEY) {
	console.error("OPENAI_API_KEY is required");
	process.exit(1);
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;
const EMBEDDING_BATCH = 256;

const client = postgres(DATABASE_URL, { max: 5 });
const db = drizzle(client);

async function embedTexts(texts: string[]): Promise<number[][]> {
	const res = await fetch("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${OPENAI_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: EMBEDDING_MODEL,
			input: texts,
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`OpenAI embedding error ${res.status}: ${body}`);
	}
	const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
	json.data.sort((a, b) => a.index - b.index);
	return json.data.map((d) => d.embedding);
}

async function main() {
	const start = Date.now();
	const pending = await db.execute(sql<{ id: string; text: string }[]>`
		SELECT id, text FROM bible_chunks WHERE embedding_small IS NULL ORDER BY id
	`);
	const rows = pending as unknown as { id: string; text: string }[];
	console.log(`${rows.length} chunks need embedding`);
	if (rows.length === 0) {
		await client.end();
		return;
	}

	let done = 0;
	for (let i = 0; i < rows.length; i += EMBEDDING_BATCH) {
		const batch = rows.slice(i, i + EMBEDDING_BATCH);
		const embeddings = await embedTexts(batch.map((b) => b.text));

		const valuesSql = sql.join(
			batch.map((b, j) => {
				const emb = embeddings[j];
				if (!emb || emb.length !== EMBEDDING_DIMS) {
					throw new Error(`Embedding dim mismatch for ${b.id}: got ${emb?.length}`);
				}
				return sql`(${b.id}, ${`[${emb.join(",")}]`}::vector)`;
			}),
			sql`, `,
		);
		await db.execute(sql`
			UPDATE bible_chunks
			SET embedding_small = u.emb
			FROM (VALUES ${valuesSql}) AS u(id, emb)
			WHERE bible_chunks.id = u.id
		`);
		done += batch.length;
		console.log(`  Embedded ${done} / ${rows.length}`);
	}

	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`\nDone in ${elapsed}s`);
	await client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
