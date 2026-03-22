/**
 * translate-entities.ts — Translate Urantia Book entities to target languages
 *
 * Usage:
 *   bun scripts/translate/translate-entities.ts --lang=es
 *   bun scripts/translate/translate-entities.ts --lang=es --entity=machiventa-melchizedek
 *   bun scripts/translate/translate-entities.ts --lang=es --limit=20
 *   bun scripts/translate/translate-entities.ts --lang=es --dry-run
 *
 * Uses Claude Sonnet for high-quality entity translations.
 * Foundation parallel text is used as reference context only — output is independent.
 * Idempotent: resumes from existing output file, skips already-translated entities.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = join(import.meta.dir, "../..");
const URANTIAPEDIA = join(ROOT, "../misc/urantiapedia/input/json");
const SEED_PATH = join(ROOT, "data/entities/seed-entities.json");

const MODEL = "claude-sonnet-4-20250514";
const MAX_PARAGRAPHS = 2;
const BATCH_SIZE = 10;

const LANG_NAMES: Record<string, string> = {
	nl: "Dutch", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", ko: "Korean",
};

// --- Parse args ---
const langArg = process.argv.find((a) => a.startsWith("--lang="));
const LANG = langArg ? langArg.split("=")[1]! : "";
if (!LANG || !Object.keys(LANG_NAMES).includes(LANG)) {
	console.error(`Usage: bun scripts/translate/translate-entities.ts --lang=${Object.keys(LANG_NAMES).join("|")} [--entity=ID] [--limit=N] [--dry-run]`);
	process.exit(1);
}

const entityArg = process.argv.find((a) => a.startsWith("--entity="));
const ENTITY_FILTER = entityArg?.split("=")[1] ?? null;

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : undefined;

const DRY_RUN = process.argv.includes("--dry-run");

const OUTPUT_PATH = join(ROOT, `data/translations/${LANG}/entity-translations.json`);

// --- Anthropic client ---
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY && !DRY_RUN) {
	console.error("ANTHROPIC_API_KEY environment variable is required (skip with --dry-run)");
	process.exit(1);
}

const client = !DRY_RUN ? new Anthropic({ apiKey: ANTHROPIC_API_KEY! }) : null;

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err: unknown) {
			const isRateLimit = err instanceof Error && (
				err.message.includes("rate_limit") ||
				err.message.includes("429") ||
				err.message.includes("overloaded")
			);
			if (!isRateLimit || attempt === maxRetries) throw err;
			const waitSec = Math.min(30 * Math.pow(2, attempt), 300);
			console.log(`  Rate limited, waiting ${waitSec}s (attempt ${attempt + 1}/${maxRetries})...`);
			await new Promise((r) => setTimeout(r, waitSec * 1000));
		}
	}
	throw new Error("Unreachable");
}

// --- Types ---
type SeedEntity = {
	id: string;
	name: string;
	type: string;
	aliases: string[];
	description: string;
	seeAlso: string[];
	citations: string[];
};

type UrantiapediaParagraph = { par_ref: string; par_content: string };
type UrantiapediaSection = { section_index: number; pars: UrantiapediaParagraph[] };
type UrantiapediaPaper = { paper_index: number; sections: UrantiapediaSection[] };

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

// --- Paragraph loading (Foundation text as reference context) ---
const paperCache = new Map<string, UrantiapediaPaper>();

function loadPaper(lang: string, paperIndex: number): UrantiapediaPaper | null {
	const key = `${lang}:${paperIndex}`;
	if (paperCache.has(key)) return paperCache.get(key)!;
	const padded = String(paperIndex).padStart(3, "0");
	try {
		const data = JSON.parse(readFileSync(join(URANTIAPEDIA, `book-${lang}`, `Doc${padded}.json`), "utf-8"));
		paperCache.set(key, data);
		return data;
	} catch {
		return null;
	}
}

function findParagraph(paper: UrantiapediaPaper, ref: string): string | null {
	for (const s of paper.sections) for (const p of s.pars) if (p.par_ref === ref) return p.par_content;
	return null;
}

function findFirstInSection(paper: UrantiapediaPaper, sectionIndex: number): { ref: string; content: string } | null {
	for (const s of paper.sections) {
		if (s.section_index === sectionIndex && s.pars.length > 0) {
			return { ref: s.pars[0]!.par_ref, content: s.pars[0]!.par_content };
		}
	}
	return null;
}

function parseCitation(ref: string) {
	const exact = ref.match(/^(\d+):(\d+)\.(\d+)$/);
	if (exact) return { paper: Number(exact[1]), section: Number(exact[2]), paragraph: Number(exact[3]) };
	const sec = ref.match(/^(\d+):(\d+)$/);
	if (sec) return { paper: Number(sec[1]), section: Number(sec[2]) };
	return null;
}

function sampleEvenly<T>(items: T[], max: number): T[] {
	if (items.length <= max) return items;
	const result: T[] = [];
	const step = items.length / max;
	for (let i = 0; i < max; i++) result.push(items[Math.floor(i * step)]!);
	return result;
}

type ParagraphPair = { ref: string; en: string; target: string };

function getEntityParagraphPairs(entity: SeedEntity): ParagraphPair[] {
	const sampled = sampleEvenly(entity.citations, MAX_PARAGRAPHS);
	const pairs: ParagraphPair[] = [];
	for (const citation of sampled) {
		const parsed = parseCitation(citation);
		if (!parsed) continue;
		const enPaper = loadPaper("en", parsed.paper);
		const targetPaper = loadPaper(LANG, parsed.paper);
		if (!enPaper || !targetPaper) continue;

		if ("paragraph" in parsed) {
			const en = findParagraph(enPaper, citation);
			const target = findParagraph(targetPaper, citation);
			if (en && target) pairs.push({ ref: citation, en, target });
		} else {
			const enFirst = findFirstInSection(enPaper, parsed.section);
			const targetFirst = findFirstInSection(targetPaper, parsed.section);
			if (enFirst && targetFirst) pairs.push({ ref: enFirst.ref, en: enFirst.content, target: targetFirst.content });
		}
	}
	return pairs;
}

// --- Claude translation ---

async function translateBatch(batch: SeedEntity[]): Promise<TranslationEntry[]> {
	const context = batch.map((entity, i) => {
		const pairs = getEntityParagraphPairs(entity);
		const pairsText = pairs.length > 0
			? pairs.map((p, j) =>
				`  [${j + 1}] (${p.ref})\n    EN: "${p.en}"\n    ${LANG_NAMES[LANG]} (Foundation, reference only): "${p.target}"`
			).join("\n\n")
			: "  (no paragraph pairs available)";

		return `[${i + 1}] Entity: "${entity.name}" (id: ${entity.id}, type: ${entity.type})
Aliases: ${entity.aliases.length > 0 ? entity.aliases.join(", ") : "(none)"}
Description: "${entity.description || "(empty)"}"

Paragraph pairs (EN + Foundation ${LANG_NAMES[LANG]} for reference):
${pairsText}`;
	}).join("\n\n===\n\n");

	const response = await callWithRetry(() => client!.messages.create({
		model: MODEL,
		max_tokens: 16384,
		system: `You are translating Urantia Book entities from English to ${LANG_NAMES[LANG]}. You must produce a single high-quality, independent translation for each entity.

The Foundation ${LANG_NAMES[LANG]} translations are provided as REFERENCE CONTEXT only — they help you understand how terms are used in context. However, your translation must be INDEPENDENT and SUPERIOR:
- More natural and readable to a modern ${LANG_NAMES[LANG]} speaker
- More precise and faithful to the original meaning
- NOT a paraphrase or copy of the Foundation translation

For EACH entity, provide:
- "name": The translated entity name
- "aliases": Array of translated aliases (or null if none)
- "description": The entity description translated into ${LANG_NAMES[LANG]} (same length/detail as English original)
- "confidence": "high" if clearly identifiable in context, "medium" if inferred, "needs_manual" if uncertain

Rules:
- Proper nouns that are Urantia Book coinages (Melchizedek, Urantia, Nebadon, Havona, Machiventa, etc.) typically stay UNCHANGED across languages
- Common English words used as proper names should be translated (e.g. "Paradise" → translated, "Thought Adjuster" → translated)
- Translate the full description with the same level of detail as the original
- For entities with no paragraph pairs, translate based on name and description alone
- Aim for natural, modern ${LANG_NAMES[LANG]} — not archaic or overly formal

Respond with ONLY valid JSON array — no markdown fences:
[
  {
    "id": "entity-id",
    "name": "...",
    "aliases": [...] or null,
    "description": "...",
    "confidence": "high"
  }
]`,
		messages: [{
			role: "user",
			content: `Translate these ${batch.length} entities to ${LANG_NAMES[LANG]}:\n\n${context}`,
		}],
	}));

	const rawText = response.content[0]?.type === "text" ? response.content[0].text : "";
	const text = rawText.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

	try {
		let parsed: Array<{
			id: string;
			name: string;
			aliases: string[] | null;
			description: string;
			confidence: string;
		}>;
		try {
			parsed = JSON.parse(text);
		} catch {
			// Fallback: try to extract individual JSON objects
			const objects: typeof parsed = [];
			const objectMatches = text.matchAll(/\{[^{}]*"id"\s*:\s*"([^"]+)"[^]*?"confidence"\s*:\s*"[^"]*"\s*\}/g);
			for (const match of objectMatches) {
				try { objects.push(JSON.parse(match[0])); } catch { /* skip */ }
			}
			if (objects.length === 0) throw new Error("No valid objects found");
			parsed = objects;
		}

		const results: TranslationEntry[] = [];
		for (const entity of batch) {
			const entry = parsed.find((e) => e.id === entity.id);
			if (entry) {
				results.push({
					entityId: entity.id,
					language: LANG,
					source: "urantia.dev",
					version: 1,
					name: entry.name,
					aliases: entry.aliases,
					description: entry.description,
					confidence: entry.confidence,
				});
			} else {
				// Fallback — mark for manual review
				results.push({
					entityId: entity.id,
					language: LANG,
					source: "urantia.dev",
					version: 1,
					name: entity.name,
					aliases: null,
					description: "",
					confidence: "needs_manual",
				});
			}
		}
		return results;
	} catch (err) {
		console.error("  Parse error:", (err as Error).message);
		console.error("  Response length:", rawText.length, "| stop_reason:", response.stop_reason);
		return batch.map((entity) => ({
			entityId: entity.id,
			language: LANG,
			source: "urantia.dev",
			version: 1,
			name: entity.name,
			aliases: null,
			description: "",
			confidence: "needs_manual",
		}));
	}
}

// --- Main ---
const allEntities: SeedEntity[] = JSON.parse(readFileSync(SEED_PATH, "utf-8"));

// Filter by entity ID if specified
let entitiesToProcess: SeedEntity[];
if (ENTITY_FILTER) {
	entitiesToProcess = allEntities.filter((e) =>
		e.id === ENTITY_FILTER || e.id.includes(ENTITY_FILTER)
	);
	if (entitiesToProcess.length === 0) {
		console.error(`No entities found matching "${ENTITY_FILTER}"`);
		console.error(`Try one of: ${allEntities.filter((e) => e.id.includes(ENTITY_FILTER.split("-")[0] ?? "")).slice(0, 5).map((e) => e.id).join(", ")}`);
		process.exit(1);
	}
} else {
	entitiesToProcess = LIMIT ? allEntities.slice(0, LIMIT) : allEntities;
}

console.log(`\n=== Translate Entities to ${LANG_NAMES[LANG]} (${LANG}) ===`);
console.log(`Model: ${MODEL}`);
console.log(`Processing ${entitiesToProcess.length} entities${LIMIT ? ` (limited from ${allEntities.length})` : ""}${ENTITY_FILTER ? ` (filter: ${ENTITY_FILTER})` : ""}`);
if (DRY_RUN) console.log("DRY RUN — no API calls will be made");
console.log();

// Load existing translations for resumability
let translations: TranslationEntry[] = [];
const processedIds = new Set<string>();

// Ensure output directory exists
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

if (existsSync(OUTPUT_PATH)) {
	translations = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
	for (const t of translations) processedIds.add(t.entityId);
	console.log(`Resuming: ${processedIds.size} entities already translated\n`);
}

const unprocessed = entitiesToProcess.filter((e) => !processedIds.has(e.id));

if (unprocessed.length === 0) {
	console.log("All entities already translated. Nothing to do.");
	process.exit(0);
}

console.log(`${unprocessed.length} entities to translate\n`);

if (DRY_RUN) {
	console.log("Entities that would be translated:");
	for (const e of unprocessed) {
		const pairs = getEntityParagraphPairs(e);
		console.log(`  ${e.id} — "${e.name}" (${e.type}, ${e.citations.length} citations, ${pairs.length} paragraph pairs)`);
	}
	console.log(`\nEstimated batches: ${Math.ceil(unprocessed.length / BATCH_SIZE)}`);
	process.exit(0);
}

async function main() {
	const totalBatches = Math.ceil(unprocessed.length / BATCH_SIZE);

	for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
		const batch = unprocessed.slice(i, i + BATCH_SIZE);
		const batchNum = Math.floor(i / BATCH_SIZE) + 1;
		console.log(`Batch ${batchNum}/${totalBatches}: ${batch.map((b) => b.name).join(", ")}`);

		const results = await translateBatch(batch);
		translations.push(...results);
		writeFileSync(OUTPUT_PATH, JSON.stringify(translations, null, 2));

		// Brief progress
		const highCount = results.filter((r) => r.confidence === "high").length;
		const needsManualCount = results.filter((r) => r.confidence === "needs_manual").length;
		console.log(`  → ${results.length} translated (${highCount} high, ${needsManualCount} needs_manual)\n`);
	}

	// Summary
	const high = translations.filter((t) => t.confidence === "high").length;
	const medium = translations.filter((t) => t.confidence === "medium").length;
	const needsManual = translations.filter((t) => t.confidence === "needs_manual").length;

	console.log(`\n--- Translation Complete ---`);
	console.log(`  Total entries:       ${translations.length}`);
	console.log(`  Unique entities:     ${new Set(translations.map((t) => t.entityId)).size}`);
	console.log(`  High confidence:     ${high}`);
	console.log(`  Medium confidence:   ${medium}`);
	console.log(`  Needs manual:        ${needsManual}`);
	console.log(`\nOutput: ${OUTPUT_PATH}`);
}

main().catch((err) => {
	console.error("Translation failed:", err);
	process.exit(1);
});
