// Validate semantic Bible parallels against Faw's Paramony as a quality gate.
//
// Faw spent years compiling 13,749 hand-curated UB↔Bible parallels (1986).
// They are the gold-standard reference in the reader community. We don't
// ship Faw's data (license uncertain, semantic parallels are strictly
// better for AI agents), but we can use his parallels as a recall test:
// for a sample of his pairs, do our top-20 semantic neighbors include
// the Bible chunk containing his cited verse?
//
// Plan target: recall@20 ≥ 60%. Below 50% means investigate chunking or
// fall back to verse-level embeddings.
//
// Usage:
//   DATABASE_URL=... bun run scripts/validate-paramony-recall.ts
//
// Optional env:
//   PARAMONY_PATH    path to Paramony.txt (defaults to data-sources clone)
//   SAMPLE_SIZE      how many random pairs to sample (default 200)
//   TOP_K            check recall@K (default 20)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveBibleBook } from "../src/lib/bible-canonicalizer.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL is required");
	process.exit(1);
}

const PARAMONY_PATH =
	process.env.PARAMONY_PATH ??
	"/Users/kelsonic/Desktop/business/urantia/misc/urantiapedia/input/txt/paramony/Paramony.txt";

const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE ?? 200);
const TOP_K = Number(process.env.TOP_K ?? 20);

const client = postgres(DATABASE_URL, { max: 5 });
const db = drizzle(client);

type FawRow = {
	parRef: string; // "000:02.09" — paper:section.paragraph
	bookOsis: string; // resolved OSIS like "Gen", "Acts"
	chapter: number;
	verseStart: number;
	verseEnd: number;
};

// Normalize Paramony's par_ref ("000:02.09/all") to our standardReferenceId
// ("0:2.9"). Strips leading zeros from each numeric segment and drops the
// /lineRange suffix.
function normalizePar(ref: string): string | null {
	const noSuffix = ref.split("/")[0];
	if (!noSuffix) return null;
	// Match "000:02.09" form
	const m = noSuffix.match(/^(\d+):(\d+)\.(\d+)$/);
	if (!m) return null;
	const [, paper, section, para] = m;
	return `${parseInt(paper!, 10)}:${parseInt(section!, 10)}.${parseInt(para!, 10)}`;
}

// Parse Paramony's "chapter:verse" cell. Verse can be "1", "1-3", "1,3", "1ff".
function parseChapterVerse(cell: string): { chapter: number; verseStart: number; verseEnd: number } | null {
	const m = cell.match(/^(\d+):(\d+)/);
	if (!m) return null;
	const chapter = parseInt(m[1]!, 10);
	const restMatch = cell.match(/^\d+:(.+)$/);
	const rest = restMatch?.[1] ?? "";
	const rangeMatch = rest.match(/^(\d+)(?:-(\d+))?/);
	if (!rangeMatch) return null;
	const verseStart = parseInt(rangeMatch[1]!, 10);
	const verseEnd = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : verseStart;
	return { chapter, verseStart, verseEnd };
}

function loadParamony(): FawRow[] {
	const text = readFileSync(PARAMONY_PATH, "utf-8");
	const rows: FawRow[] = [];
	for (const line of text.split("\n")) {
		const cols = line.split("\t");
		if (cols.length < 6) continue;
		const parRef = normalizePar(cols[1]!);
		if (!parRef) continue;
		const bookMeta = resolveBibleBook(cols[3]!);
		if (!bookMeta) continue;
		const cv = parseChapterVerse(cols[4]!);
		if (!cv) continue;
		rows.push({
			parRef,
			bookOsis: bookMeta.osis,
			chapter: cv.chapter,
			verseStart: cv.verseStart,
			verseEnd: cv.verseEnd,
		});
	}
	return rows;
}

// Pick `n` random elements from arr without replacement.
function sample<T>(arr: T[], n: number): T[] {
	const copy = [...arr];
	const result: T[] = [];
	const max = Math.min(n, copy.length);
	for (let i = 0; i < max; i++) {
		const j = Math.floor(Math.random() * copy.length);
		result.push(copy.splice(j, 1)[0]!);
	}
	return result;
}

async function main() {
	console.log(`Loading Paramony from ${PARAMONY_PATH}...`);
	const all = loadParamony();
	console.log(`Loaded ${all.length} valid Faw parallel pairs`);

	const sampled = sample(all, SAMPLE_SIZE);
	console.log(`Sampling ${sampled.length} pairs for recall@${TOP_K} test\n`);

	let hits = 0;
	let resolved = 0;
	let unresolved = 0;
	const misses: { parRef: string; book: string; chapter: number; verseStart: number }[] = [];

	for (const row of sampled) {
		// Resolve UB par_ref to paragraph.id via standardReferenceId
		const paraRows = await db.execute(sql<{ id: string }[]>`
			SELECT id FROM paragraphs WHERE standard_reference_id = ${row.parRef} LIMIT 1
		`);
		const para = (paraRows as unknown as { id: string }[])[0];
		if (!para) {
			unresolved++;
			continue;
		}
		resolved++;

		// Find any chunk that overlaps Faw's verse range in his book/chapter.
		// A chunk spans [verseStart, verseEnd]. Faw cites a single verse or range.
		// Match if chunk overlaps the cited range.
		const chunkRows = await db.execute(sql<{ id: string }[]>`
			SELECT id FROM bible_chunks
			WHERE book_code = ${row.bookOsis}
			  AND chapter = ${row.chapter}
			  AND verse_end >= ${row.verseStart}
			  AND verse_start <= ${row.verseEnd}
		`);
		const targetChunkIds = new Set(
			(chunkRows as unknown as { id: string }[]).map((r) => r.id),
		);
		if (targetChunkIds.size === 0) continue;

		// Get our top-K Bible parallels for this paragraph.
		const topRows = await db.execute(sql<{ chunk_id: string }[]>`
			SELECT bible_chunk_id AS chunk_id
			FROM bible_parallels
			WHERE paragraph_id = ${para.id}
			  AND direction = 'ub_to_bible'
			ORDER BY rank
			LIMIT ${TOP_K}
		`);
		const ourTop = new Set(
			(topRows as unknown as { chunk_id: string }[]).map((r) => r.chunk_id),
		);

		const hit = [...targetChunkIds].some((id) => ourTop.has(id));
		if (hit) {
			hits++;
		} else {
			if (misses.length < 10) {
				misses.push({
					parRef: row.parRef,
					book: row.bookOsis,
					chapter: row.chapter,
					verseStart: row.verseStart,
				});
			}
		}
	}

	console.log(`Results:`);
	console.log(`  Resolved:   ${resolved} / ${sampled.length} (Faw rows that mapped to existing UB paragraphs and Bible chunks)`);
	console.log(`  Unresolved: ${unresolved}`);
	console.log(`  Hits:       ${hits} / ${resolved}`);
	const recall = resolved > 0 ? (hits / resolved) * 100 : 0;
	console.log(`  Recall@${TOP_K}: ${recall.toFixed(1)}%`);

	if (misses.length > 0) {
		console.log(`\n  Sample misses (first 10):`);
		for (const m of misses) {
			console.log(`    UB ${m.parRef} → ${m.book} ${m.chapter}:${m.verseStart}`);
		}
	}

	console.log();
	const gate = 60;
	if (recall >= gate) {
		console.log(`✓ Recall@${TOP_K} (${recall.toFixed(1)}%) meets the ${gate}% gate. Phase 3 is shippable.`);
	} else if (recall >= 50) {
		console.log(`~ Recall@${TOP_K} (${recall.toFixed(1)}%) is below the ${gate}% target but above 50%. Consider shipping with caveats; investigate chunking before next iteration.`);
	} else {
		console.log(`✗ Recall@${TOP_K} (${recall.toFixed(1)}%) is below 50%. Investigate chunking strategy or embedding model before shipping.`);
	}

	await client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
