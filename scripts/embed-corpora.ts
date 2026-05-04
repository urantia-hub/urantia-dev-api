// Phase 2 pipeline: chunk Bible verses, embed both corpora with
// text-embedding-3-large (3072-d), and store everything in pgvector.
//
// This script is **non-breaking** for production endpoints. It only writes
// new columns and a new table. The /search/semantic cutover that switches
// reads from `paragraphs.embedding` (1536-d) to `paragraphs.embedding_v2`
// (3072-d) is intentionally a separate step (Phase 2d in the plan), to be
// run with focused attention.
//
// Usage:
//   DATABASE_URL=... OPENAI_API_KEY=... bun run scripts/embed-corpora.ts
//
// Optional flags via env:
//   PHASE=chunks        only build bible_chunks (skip embedding + UB)
//   PHASE=bible         only embed bible_chunks (skip chunk-build + UB)
//   PHASE=ub            only re-embed UB paragraphs into embedding_v2
//   PHASE=all (default) full pipeline
//
// The script is idempotent: re-running picks up where it left off
// (chunks with NULL embedding get embedded; UB rows with NULL embedding_v2
// get embedded).

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { bibleChunks, bibleVerses, paragraphs } from "../src/db/schema.ts";

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

const PHASE = process.env.PHASE ?? "all";
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMS = 3072;

// OpenAI batch size: 2048 is the max input array length. We use 256 here
// so individual requests stay reasonable in size even with longer texts.
const EMBEDDING_BATCH = 256;

const client = postgres(DATABASE_URL, { max: 5 });
const db = drizzle(client);

// ---------------------------------------------------------------------------
// Phase 2a — build bible_chunks from bible_verses by (bookCode, paragraphIndex)
// ---------------------------------------------------------------------------
async function buildChunks() {
	console.log("\n=== Phase 2a — building bible_chunks ===");

	// Pull every verse in canonical order. Done as a single fetch rather than
	// keyset pagination because 38K rows fit comfortably.
	const rows = await db
		.select({
			id: bibleVerses.id,
			bookCode: bibleVerses.bookCode,
			chapter: bibleVerses.chapter,
			verse: bibleVerses.verse,
			text: bibleVerses.text,
			paragraphIndex: bibleVerses.paragraphIndex,
			bookOrder: bibleVerses.bookOrder,
		})
		.from(bibleVerses)
		.orderBy(bibleVerses.bookOrder, bibleVerses.chapter, bibleVerses.verse);

	console.log(`  Loaded ${rows.length} verses`);

	// Group by (bookCode, paragraphIndex). Verses arrive in canonical order
	// so each group's verses are contiguous and ordered.
	type Group = {
		bookCode: string;
		chapter: number;
		paragraphIndex: number;
		verseStart: number;
		verseEnd: number;
		texts: string[];
		verseIds: string[];
	};
	const groups: Group[] = [];
	let current: Group | null = null;

	for (const r of rows) {
		const idx = r.paragraphIndex ?? 0;
		if (
			current === null ||
			current.bookCode !== r.bookCode ||
			current.paragraphIndex !== idx ||
			// Defensive: even if paragraphIndex is the same but the verse
			// crosses a chapter boundary (shouldn't happen in well-formed
			// USFM), start a new chunk.
			current.chapter !== r.chapter
		) {
			current = {
				bookCode: r.bookCode,
				chapter: r.chapter,
				paragraphIndex: idx,
				verseStart: r.verse,
				verseEnd: r.verse,
				texts: [r.text],
				verseIds: [r.id],
			};
			groups.push(current);
		} else {
			current.verseEnd = r.verse;
			current.texts.push(r.text);
			current.verseIds.push(r.id);
		}
	}

	console.log(`  Built ${groups.length} chunks`);

	// Build chunk rows + per-verse chunkId updates.
	type ChunkRow = typeof bibleChunks.$inferInsert;
	const chunkRows: ChunkRow[] = [];
	const verseToChunk = new Map<string, string>();

	for (const g of groups) {
		const id =
			g.verseStart === g.verseEnd
				? `${g.bookCode}.${g.chapter}.${g.verseStart}`
				: `${g.bookCode}.${g.chapter}.${g.verseStart}-${g.verseEnd}`;
		chunkRows.push({
			id,
			bookCode: g.bookCode,
			chapter: g.chapter,
			verseStart: g.verseStart,
			verseEnd: g.verseEnd,
			text: g.texts.join(" "),
		});
		for (const vid of g.verseIds) verseToChunk.set(vid, id);
	}

	// Insert chunks (idempotent — re-runs are no-ops if text is unchanged).
	for (let i = 0; i < chunkRows.length; i += 500) {
		const batch = chunkRows.slice(i, i + 500);
		await db
			.insert(bibleChunks)
			.values(batch)
			.onConflictDoUpdate({
				target: bibleChunks.id,
				set: { text: sql`excluded.text` },
			});
		console.log(`  Inserted chunks ${i + 1}–${Math.min(i + 500, chunkRows.length)} / ${chunkRows.length}`);
	}

	// Bulk-update bible_verses.chunkId by joining against a values table.
	console.log("  Updating bible_verses.chunk_id...");
	const verseUpdates = Array.from(verseToChunk.entries());
	for (let i = 0; i < verseUpdates.length; i += 1000) {
		const batch = verseUpdates.slice(i, i + 1000);
		// Build a single UPDATE ... FROM (VALUES ...) that handles 1k rows
		// at once. Postgres handles this comfortably.
		const valuesSql = sql.join(
			batch.map(([vid, cid]) => sql`(${vid}, ${cid})`),
			sql`, `,
		);
		await db.execute(sql`
			UPDATE bible_verses
			SET chunk_id = u.chunk_id
			FROM (VALUES ${valuesSql}) AS u(verse_id, chunk_id)
			WHERE bible_verses.id = u.verse_id
		`);
		console.log(`    ${Math.min(i + 1000, verseUpdates.length)} / ${verseUpdates.length}`);
	}

	console.log("  Done.");
}

// ---------------------------------------------------------------------------
// OpenAI embedding helper. Input: string[]. Output: number[][] (3072-d each).
// ---------------------------------------------------------------------------
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
	// Sort by index to be safe — OpenAI returns in input order, but explicit.
	json.data.sort((a, b) => a.index - b.index);
	return json.data.map((d) => d.embedding);
}

// ---------------------------------------------------------------------------
// Phase 2b — embed bible_chunks with text-embedding-3-large
// ---------------------------------------------------------------------------
async function embedBibleChunks() {
	console.log("\n=== Phase 2b — embedding bible_chunks ===");

	const pending = await db
		.select({ id: bibleChunks.id, text: bibleChunks.text })
		.from(bibleChunks)
		.where(sql`embedding IS NULL OR embedding_model IS NULL OR embedding_model <> ${EMBEDDING_MODEL}`);

	console.log(`  ${pending.length} chunks need embedding`);
	if (pending.length === 0) return;

	let done = 0;
	for (let i = 0; i < pending.length; i += EMBEDDING_BATCH) {
		const batch = pending.slice(i, i + EMBEDDING_BATCH);
		const embeddings = await embedTexts(batch.map((b) => b.text));

		// Update each chunk's embedding. Use a single bulk UPDATE per batch.
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
			SET embedding = u.emb,
			    embedding_model = ${EMBEDDING_MODEL}
			FROM (VALUES ${valuesSql}) AS u(id, emb)
			WHERE bible_chunks.id = u.id
		`);
		done += batch.length;
		console.log(`  Embedded ${done} / ${pending.length} chunks`);
	}
	console.log("  Done.");
}

// ---------------------------------------------------------------------------
// Phase 2c — re-embed UB paragraphs into embedding_v2 (3072-d)
// ---------------------------------------------------------------------------
async function embedParagraphsV2() {
	console.log("\n=== Phase 2c — re-embedding UB paragraphs into embedding_v2 ===");

	const pending = await db
		.select({ id: paragraphs.id, text: paragraphs.text })
		.from(paragraphs)
		.where(sql`embedding_v2 IS NULL`);

	console.log(`  ${pending.length} paragraphs need embedding`);
	if (pending.length === 0) return;

	let done = 0;
	for (let i = 0; i < pending.length; i += EMBEDDING_BATCH) {
		const batch = pending.slice(i, i + EMBEDDING_BATCH);
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
			UPDATE paragraphs
			SET embedding_v2 = u.emb
			FROM (VALUES ${valuesSql}) AS u(id, emb)
			WHERE paragraphs.id = u.id
		`);
		done += batch.length;
		console.log(`  Embedded ${done} / ${pending.length} UB paragraphs`);
	}
	console.log("  Done.");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
	const start = Date.now();
	if (PHASE === "all" || PHASE === "chunks") await buildChunks();
	if (PHASE === "all" || PHASE === "bible") await embedBibleChunks();
	if (PHASE === "all" || PHASE === "ub") await embedParagraphsV2();
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	console.log(`\nTotal wall-clock: ${elapsed}s`);
	await client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
