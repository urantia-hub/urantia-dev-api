/**
 * seed-entity-translations.ts — Seed entity translations into the database
 *
 * Usage:
 *   bun scripts/seed-entity-translations.ts
 *   bun scripts/seed-entity-translations.ts --lang=es  (single language)
 *   bun scripts/seed-entity-translations.ts --dry-run
 *
 * Reads entity-translations.json for each language and upserts into the
 * entity_translations table. Idempotent via ON CONFLICT DO UPDATE.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { entityTranslations } from "../src/db/schema.ts";
import { sql } from "drizzle-orm";

const ROOT = join(import.meta.dir, "..");

const LANG_NAMES: Record<string, string> = {
	nl: "Dutch", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", ko: "Korean",
};

// --- Parse args ---
const langArg = process.argv.find((a) => a.startsWith("--lang="));
const LANG_FILTER = langArg?.split("=")[1] ?? null;
const DRY_RUN = process.argv.includes("--dry-run");

if (LANG_FILTER && !Object.keys(LANG_NAMES).includes(LANG_FILTER)) {
	console.error(`Invalid language: ${LANG_FILTER}. Supported: ${Object.keys(LANG_NAMES).join(", ")}`);
	process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && !DRY_RUN) {
	console.error("DATABASE_URL environment variable is required (skip with --dry-run)");
	process.exit(1);
}

// --- Types ---
type TranslationEntry = {
	entityId: string;
	language: string;
	source: string;
	version: number;
	name: string;
	aliases: string[] | null;
	description: string;
	confidence: string;
};

// --- Load translations ---
const languages = LANG_FILTER ? [LANG_FILTER] : Object.keys(LANG_NAMES);
const allTranslations: TranslationEntry[] = [];

console.log(`\n=== Seed Entity Translations ===\n`);
if (DRY_RUN) console.log("DRY RUN — no database changes\n");

for (const lang of languages) {
	const path = join(ROOT, `data/translations/${lang}/entity-translations.json`);
	if (!existsSync(path)) {
		console.log(`  ${lang}: no translations file found, skipping`);
		continue;
	}
	const entries: TranslationEntry[] = JSON.parse(readFileSync(path, "utf-8"));
	console.log(`  ${lang} (${LANG_NAMES[lang]}): ${entries.length} entries`);
	allTranslations.push(...entries);
}

if (allTranslations.length === 0) {
	console.log("\nNo translations to seed.");
	process.exit(0);
}

console.log(`\nTotal entries to seed: ${allTranslations.length}`);

if (DRY_RUN) {
	console.log("\nDry run complete. Would upsert the above entries.");
	process.exit(0);
}

// --- Seed to DB ---
const client = postgres(DATABASE_URL!);
const db = drizzle(client);

const BATCH_SIZE = 100;

async function main() {
	let upserted = 0;

	for (let i = 0; i < allTranslations.length; i += BATCH_SIZE) {
		const batch = allTranslations.slice(i, i + BATCH_SIZE);

		const values = batch.map((entry) => ({
			id: `${entry.entityId}:${entry.language}:${entry.source}:v${entry.version}`,
			entityId: entry.entityId,
			language: entry.language,
			source: entry.source,
			version: entry.version,
			name: entry.name,
			aliases: entry.aliases,
			description: entry.description,
			confidence: entry.confidence,
		}));

		await db.insert(entityTranslations).values(values).onConflictDoUpdate({
			target: entityTranslations.id,
			set: {
				name: sql`excluded.name`,
				aliases: sql`excluded.aliases`,
				description: sql`excluded.description`,
				confidence: sql`excluded.confidence`,
			},
		});

		upserted += batch.length;
	}

	console.log(`\nSeeded ${upserted} entity translations successfully.`);
	await client.end();
}

main().catch(async (err) => {
	console.error("Seeding failed:", err);
	await client.end();
	process.exit(1);
});
