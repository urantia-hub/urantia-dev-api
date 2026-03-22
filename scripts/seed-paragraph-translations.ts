/**
 * seed-paragraph-translations.ts — Seed paragraph and title translations into the database
 *
 * Usage:
 *   bun scripts/seed-paragraph-translations.ts
 *   bun scripts/seed-paragraph-translations.ts --lang=es
 *   bun scripts/seed-paragraph-translations.ts --dry-run
 *
 * Reads paragraph and title translation JSON files and upserts into the
 * paragraph_translations and title_translations tables.
 * Idempotent via ON CONFLICT DO UPDATE.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { paragraphTranslations, titleTranslations } from "../src/db/schema.ts";
import { sql } from "drizzle-orm";

const ROOT = join(import.meta.dir, "..");

const LANG_NAMES: Record<string, string> = {
	nl: "Dutch", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", ko: "Korean",
};

// --- Parse args ---
const langArg = process.argv.find((a) => a.startsWith("--lang="));
const LANG_FILTER = langArg?.split("=")[1] ?? null;
const DRY_RUN = process.argv.includes("--dry-run");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && !DRY_RUN) {
	console.error("DATABASE_URL environment variable is required (skip with --dry-run)");
	process.exit(1);
}

// --- Types ---
type ParagraphTranslation = {
	paragraphId: string;
	globalId: string;
	standardReferenceId: string;
	language: string;
	version: number;
	text: string;
	htmlText: string;
	source: string;
	confidence: string;
};

type TitleTranslation = {
	sourceType: "paper" | "section";
	sourceId: string;
	language: string;
	version: number;
	title: string;
	source: string;
	confidence: string;
};

// --- Load translations ---
const languages = LANG_FILTER ? [LANG_FILTER] : Object.keys(LANG_NAMES);

console.log(`\n=== Seed Paragraph & Title Translations ===\n`);
if (DRY_RUN) console.log("DRY RUN — no database changes\n");

let totalParagraphs = 0;
let totalTitles = 0;

const allParagraphTranslations: ParagraphTranslation[] = [];
const allTitleTranslations: TitleTranslation[] = [];

for (const lang of languages) {
	// Load paragraph translations
	const paraDir = join(ROOT, `data/translations/${lang}/paragraphs`);
	if (existsSync(paraDir)) {
		const files = readdirSync(paraDir).filter((f) => f.endsWith(".json"));
		let langParaCount = 0;
		for (const file of files) {
			const entries: ParagraphTranslation[] = JSON.parse(readFileSync(join(paraDir, file), "utf-8"));
			const valid = entries.filter((e) => e.text && e.htmlText); // skip empty/failed translations
			allParagraphTranslations.push(...valid);
			langParaCount += valid.length;
		}
		console.log(`  ${lang} paragraphs: ${langParaCount} (from ${files.length} files)`);
		totalParagraphs += langParaCount;
	}

	// Load title translations
	const titlesPath = join(ROOT, `data/translations/${lang}/titles.json`);
	if (existsSync(titlesPath)) {
		const entries: TitleTranslation[] = JSON.parse(readFileSync(titlesPath, "utf-8"));
		allTitleTranslations.push(...entries);
		console.log(`  ${lang} titles: ${entries.length}`);
		totalTitles += entries.length;
	}
}

console.log(`\nTotal: ${totalParagraphs} paragraphs + ${totalTitles} titles`);

if (totalParagraphs === 0 && totalTitles === 0) {
	console.log("\nNo translations to seed.");
	process.exit(0);
}

if (DRY_RUN) {
	console.log("\nDry run complete.");
	process.exit(0);
}

// --- Seed to DB ---
const client = postgres(DATABASE_URL!);
const db = drizzle(client);

const BATCH_SIZE = 100;

async function main() {
	let upsertedParas = 0;
	let upsertedTitles = 0;

	// Seed paragraphs
	if (allParagraphTranslations.length > 0) {
		console.log(`\nSeeding ${allParagraphTranslations.length} paragraph translations...`);
		for (let i = 0; i < allParagraphTranslations.length; i += BATCH_SIZE) {
			const batch = allParagraphTranslations.slice(i, i + BATCH_SIZE);

			const values = batch.map((entry) => ({
				id: `${entry.paragraphId}:${entry.language}:v${entry.version}`,
				paragraphId: entry.paragraphId,
				language: entry.language,
				version: entry.version,
				text: entry.text,
				htmlText: entry.htmlText,
				source: entry.source,
				confidence: entry.confidence,
			}));

			await db.insert(paragraphTranslations).values(values).onConflictDoUpdate({
				target: paragraphTranslations.id,
				set: {
					text: sql`excluded.text`,
					htmlText: sql`excluded.html_text`,
					confidence: sql`excluded.confidence`,
				},
			});

			upsertedParas += batch.length;
			if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= allParagraphTranslations.length) {
				console.log(`  ${upsertedParas}/${allParagraphTranslations.length} paragraphs seeded`);
			}
		}
	}

	// Seed titles
	if (allTitleTranslations.length > 0) {
		console.log(`\nSeeding ${allTitleTranslations.length} title translations...`);
		for (let i = 0; i < allTitleTranslations.length; i += BATCH_SIZE) {
			const batch = allTitleTranslations.slice(i, i + BATCH_SIZE);

			const values = batch.map((entry) => ({
				id: `${entry.sourceType}:${entry.sourceId}:${entry.language}:v${entry.version}`,
				sourceType: entry.sourceType,
				sourceId: entry.sourceId,
				language: entry.language,
				version: entry.version,
				title: entry.title,
				source: entry.source,
				confidence: entry.confidence,
			}));

			await db.insert(titleTranslations).values(values).onConflictDoUpdate({
				target: titleTranslations.id,
				set: {
					title: sql`excluded.title`,
					confidence: sql`excluded.confidence`,
				},
			});

			upsertedTitles += batch.length;
		}
	}

	console.log(`\nSeeded ${upsertedParas} paragraph translations + ${upsertedTitles} title translations.`);
	await client.end();
}

main().catch(async (err) => {
	console.error("Seeding failed:", err);
	await client.end();
	process.exit(1);
});
