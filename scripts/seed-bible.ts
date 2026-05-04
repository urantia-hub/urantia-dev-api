// Seed bible_verses from the eBible.org `eng-web` USFM bundle.
//
// Mirrors scripts/seed-entities.ts: env-var data path, batched 500-row
// inserts, ON CONFLICT DO UPDATE so re-runs are idempotent and pick up
// upstream corrections from eBible.org.
//
// Usage:
//   DATABASE_URL=... bun run scripts/seed-bible.ts
//
// Optional env vars:
//   BIBLE_USFM_DIR       Path to extracted .usfm files. Defaults to the
//                        sibling urantia-data-sources clone.
//   BIBLE_SOURCE_VERSION The label stored on every row (e.g., "web-2026-04-23").
//                        Defaults to the directory's modification date.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { bibleVerses } from "../src/db/schema.ts";
import {
	BIBLE_BOOKS,
	bibleVerseId,
	osisFromUsfm,
} from "../src/lib/bible-canonicalizer.ts";
import { parseUsfm } from "../src/lib/usfm-parser.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL environment variable is required");
	process.exit(1);
}

const USFM_DIR =
	process.env.BIBLE_USFM_DIR ??
	join(import.meta.dir, "../../urantia-data-sources/data/bible/eng-web_usfm");

function deriveSourceVersion(dir: string): string {
	if (process.env.BIBLE_SOURCE_VERSION) return process.env.BIBLE_SOURCE_VERSION;
	// Use the mtime of any USFM file as the snapshot date — eBible.org
	// repackages the whole zip on every update, so all files share the date.
	try {
		const sample = readdirSync(dir).find((f) => f.endsWith(".usfm"));
		if (!sample) return "web-unknown";
		const mtime = statSync(join(dir, sample)).mtime;
		const yyyy = mtime.getUTCFullYear();
		const mm = String(mtime.getUTCMonth() + 1).padStart(2, "0");
		const dd = String(mtime.getUTCDate()).padStart(2, "0");
		return `web-${yyyy}-${mm}-${dd}`;
	} catch {
		return "web-unknown";
	}
}

const SOURCE_VERSION = deriveSourceVersion(USFM_DIR);

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function seed() {
	console.log(`Seeding bible_verses from: ${USFM_DIR}`);
	console.log(`Source version: ${SOURCE_VERSION}`);

	// Build a quick lookup: OSIS → book metadata (name, order, canon).
	const meta = new Map(BIBLE_BOOKS.map((b) => [b.osis, b]));

	// Find all .usfm files except FRT (preface) and GLO (glossary).
	const files = readdirSync(USFM_DIR)
		.filter(
			(f) =>
				f.endsWith(".usfm") && !f.startsWith("00-FRT") && !f.startsWith("106-GLO"),
		)
		.sort();

	console.log(`Found ${files.length} book files`);

	// Buffer all rows from all books, then batch-insert at the end.
	type VerseRow = typeof bibleVerses.$inferInsert;
	const allRows: VerseRow[] = [];
	const skipped: string[] = [];

	for (const file of files) {
		const content = readFileSync(join(USFM_DIR, file), "utf-8");
		const parsed = parseUsfm(content);
		if (!parsed) {
			skipped.push(file);
			continue;
		}

		const m = meta.get(parsed.bookCode);
		if (!m) {
			console.warn(`  Unknown OSIS code ${parsed.bookCode} from ${file}, skipping`);
			skipped.push(file);
			continue;
		}

		for (const v of parsed.verses) {
			allRows.push({
				id: bibleVerseId(parsed.bookCode, v.chapter, v.verse),
				bookCode: parsed.bookCode,
				bookName: m.name,
				bookOrder: m.order,
				canon: m.canon,
				chapter: v.chapter,
				verse: v.verse,
				text: v.text,
				paragraphMarker: v.paragraphMarker,
				translation: "web",
				sourceVersion: SOURCE_VERSION,
			});
		}
	}

	console.log(`Parsed ${allRows.length} verses across ${files.length - skipped.length} books`);
	if (skipped.length > 0) {
		console.warn(`Skipped ${skipped.length} files: ${skipped.join(", ")}`);
	}

	// Batch insert with ON CONFLICT DO UPDATE so corrections from upstream are
	// applied on re-run.
	console.log("\n--- Inserting bible_verses ---");
	for (let i = 0; i < allRows.length; i += 500) {
		const batch = allRows.slice(i, i + 500);
		await db
			.insert(bibleVerses)
			.values(batch)
			.onConflictDoUpdate({
				target: bibleVerses.id,
				set: {
					text: sql`excluded.text`,
					paragraphMarker: sql`excluded.paragraph_marker`,
					sourceVersion: sql`excluded.source_version`,
				},
			});
		const end = Math.min(i + 500, allRows.length);
		console.log(`  Upserted ${i + 1}–${end} / ${allRows.length}`);
	}

	// Summarize what's in the DB now.
	const counts = await db.execute(sql<{ canon: string; n: number }[]>`
		SELECT canon, COUNT(*)::int AS n FROM bible_verses GROUP BY canon ORDER BY canon;
	`);
	console.log("\nFinal counts by canon:");
	for (const row of counts as unknown as { canon: string; n: number }[]) {
		console.log(`  ${row.canon}: ${row.n}`);
	}

	const total = await db.execute(sql<{ n: number }[]>`
		SELECT COUNT(*)::int AS n FROM bible_verses;
	`);
	const totalRow = (total as unknown as { n: number }[])[0];
	console.log(`  total: ${totalRow?.n ?? 0}`);

	await client.end();
	console.log("\nDone.");
}

seed().catch((err) => {
	console.error(err);
	process.exit(1);
});

// Test that bible-canonicalizer aliases referenced above are present
// (helps catch typos in this script during refactors).
osisFromUsfm("GEN");
