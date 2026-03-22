/**
 * build-term-glossary.ts — Extract entity name mappings for paragraph translation
 *
 * Usage:
 *   bun scripts/translate/build-term-glossary.ts --lang=es
 *
 * Reads completed entity translations and produces a flat glossary mapping
 * English entity names to their translated equivalents. This glossary is
 * injected into paragraph translation prompts as a hard constraint.
 *
 * No API calls — purely local transformation.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const SEED_PATH = join(ROOT, "data/entities/seed-entities.json");

const LANG_NAMES: Record<string, string> = {
	nl: "Dutch", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", ko: "Korean",
};

// --- Parse args ---
const langArg = process.argv.find((a) => a.startsWith("--lang="));
const LANG = langArg ? langArg.split("=")[1]! : "";
if (!LANG || !Object.keys(LANG_NAMES).includes(LANG)) {
	console.error(`Usage: bun scripts/translate/build-term-glossary.ts --lang=${Object.keys(LANG_NAMES).join("|")}`);
	process.exit(1);
}

const TRANSLATIONS_PATH = join(ROOT, `data/translations/${LANG}/entity-translations.json`);
const OUTPUT_PATH = join(ROOT, `data/translations/${LANG}/term-glossary.json`);

// --- Types ---
type SeedEntity = {
	id: string;
	name: string;
	type: string;
	aliases: string[];
};

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

// --- Load data ---
const allEntities: SeedEntity[] = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
const entityById = new Map(allEntities.map((e) => [e.id, e]));

let translations: TranslationEntry[];
try {
	translations = JSON.parse(readFileSync(TRANSLATIONS_PATH, "utf-8"));
} catch {
	console.error(`No entity translations found at ${TRANSLATIONS_PATH}`);
	console.error(`Run translate-entities.ts --lang=${LANG} first.`);
	process.exit(1);
}

console.log(`\n=== Build Term Glossary for ${LANG_NAMES[LANG]} (${LANG}) ===\n`);
console.log(`Entity translations loaded: ${translations.length}`);

// --- Build glossary ---
// Maps English name → translated name (and aliases → translated aliases)
const glossary: Record<string, string> = {};
let unchanged = 0;
let translated = 0;

for (const entry of translations) {
	const seedEntity = entityById.get(entry.entityId);
	if (!seedEntity) continue;

	// Map English name → translated name
	if (seedEntity.name !== entry.name) {
		glossary[seedEntity.name] = entry.name;
		translated++;
	} else {
		glossary[seedEntity.name] = entry.name; // Still include unchanged names
		unchanged++;
	}

	// Map English aliases → translated aliases
	if (seedEntity.aliases && entry.aliases) {
		for (let i = 0; i < Math.min(seedEntity.aliases.length, entry.aliases.length); i++) {
			const enAlias = seedEntity.aliases[i]!;
			const translatedAlias = entry.aliases[i]!;
			if (enAlias && translatedAlias) {
				glossary[enAlias] = translatedAlias;
			}
		}
	}
}

// --- Write output ---
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(glossary, null, 2));

console.log(`\nGlossary entries: ${Object.keys(glossary).length}`);
console.log(`  Translated (name differs): ${translated}`);
console.log(`  Unchanged (proper nouns):  ${unchanged}`);
console.log(`\nOutput: ${OUTPUT_PATH}`);

// Show some examples
console.log(`\nSample entries:`);
const entries = Object.entries(glossary);
const examples = entries.filter(([en, tr]) => en !== tr).slice(0, 10);
if (examples.length > 0) {
	for (const [en, tr] of examples) {
		console.log(`  "${en}" → "${tr}"`);
	}
} else {
	console.log("  (all names unchanged)");
}
const unchangedExamples = entries.filter(([en, tr]) => en === tr).slice(0, 5);
if (unchangedExamples.length > 0) {
	console.log(`\nUnchanged proper nouns (sample):`);
	for (const [en] of unchangedExamples) {
		console.log(`  "${en}" (kept as-is)`);
	}
}
