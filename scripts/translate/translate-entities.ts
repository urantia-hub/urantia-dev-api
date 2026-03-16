import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = join(import.meta.dir, "../..");
const URANTIAPEDIA = join(ROOT, "../urantiapedia/input/json");
const SEED_PATH = join(ROOT, "data/entities/seed-entities.json");

// Parse --lang flag (required)
const langArg = process.argv.find((a) => a.startsWith("--lang="));
const LANG = langArg ? langArg.split("=")[1]! : "";
if (!LANG || !["nl", "es", "fr", "pt", "de", "ko"].includes(LANG)) {
	console.error("Usage: bun scripts/translate/translate-entities.ts --lang=nl|es|fr|pt|de|ko [--limit=N]");
	process.exit(1);
}

const LANG_NAMES: Record<string, string> = {
	nl: "Dutch", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", ko: "Korean",
};

const OUTPUT_PATH = join(ROOT, `data/translations/${LANG}/entity-translations.json`);

const MAX_PARAGRAPHS = 2;
const BATCH_SIZE = 10;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
	console.error("ANTHROPIC_API_KEY environment variable is required");
	process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

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

// --- Paragraph loading ---
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

type ParagraphPair = { ref: string; en: string; nl: string };

function getEntityParagraphPairs(entity: SeedEntity): ParagraphPair[] {
	const sampled = sampleEvenly(entity.citations, MAX_PARAGRAPHS);
	const pairs: ParagraphPair[] = [];
	for (const citation of sampled) {
		const parsed = parseCitation(citation);
		if (!parsed) continue;
		const enPaper = loadPaper("en", parsed.paper);
		const nlPaper = loadPaper(LANG, parsed.paper);
		if (!enPaper || !nlPaper) continue;

		if ("paragraph" in parsed) {
			const en = findParagraph(enPaper, citation);
			const nl = findParagraph(nlPaper, citation);
			if (en && nl) pairs.push({ ref: citation, en, nl });
		} else {
			const enFirst = findFirstInSection(enPaper, parsed.section);
			const nlFirst = findFirstInSection(nlPaper, parsed.section);
			if (enFirst && nlFirst) pairs.push({ ref: enFirst.ref, en: enFirst.content, nl: nlFirst.content });
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
				`  [${j + 1}] (${p.ref})\n    EN: "${p.en}"\n    NL (Foundation): "${p.nl}"`
			).join("\n\n")
			: "  (no paragraph pairs available)";

		return `[${i + 1}] Entity: "${entity.name}" (id: ${entity.id}, type: ${entity.type})
Aliases: ${entity.aliases.length > 0 ? entity.aliases.join(", ") : "(none)"}
Description: "${entity.description || "(empty)"}"

Paragraph pairs (EN + Foundation ${LANG_NAMES[LANG]}):
${pairsText}`;
	}).join("\n\n===\n\n");

	const response = await callWithRetry(() => client.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 16384,
		system: `You are translating Urantia Book entities from English to ${LANG_NAMES[LANG]}. For each entity you must provide TWO translations:

1. **foundation**: Extract the ${LANG_NAMES[LANG]} translation as used in the Urantia Foundation's official ${LANG_NAMES[LANG]} translation. Look at the ${LANG_NAMES[LANG]} paragraphs provided to find the exact terms used.

2. **urantia_dev**: Your own independent, natural ${LANG_NAMES[LANG]} translation. This should sound natural to a ${LANG_NAMES[LANG]} speaker. It may be the same as foundation if that's the most natural choice.

For EACH translation, provide:
- "name": The translated entity name
- "aliases": Array of translated aliases (or null if none)
- "description": The entity description translated into ${LANG_NAMES[LANG]} (1-3 sentences)
- "confidence": "high" if clearly found in paragraphs, "medium" if inferred, "needs_manual" if uncertain

Rules:
- Proper nouns that are Urantia Book coinages (Melchizedek, Urantia, Nebadon) typically stay the same in both translations
- Translate the full description, not just the name
- Keep descriptions the same length/detail as the English original
- For entities with no paragraph pairs, translate based on name and description alone

Respond with ONLY valid JSON array — no markdown:
[
  {
    "id": "entity-id",
    "foundation": { "name": "...", "aliases": [...], "description": "...", "confidence": "high" },
    "urantia_dev": { "name": "...", "aliases": [...], "description": "...", "confidence": "high" }
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
			foundation: { name: string; aliases: string[] | null; description: string; confidence: string };
			urantia_dev: { name: string; aliases: string[] | null; description: string; confidence: string };
		}>;
		try {
			parsed = JSON.parse(text);
		} catch {
			const objects: typeof parsed = [];
			const objectMatches = text.matchAll(/\{[^{}]*"id"\s*:\s*"([^"]+)"[^]*?"urantia_dev"\s*:\s*\{[^{}]*\}[^{}]*\}/g);
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
					source: "foundation",
					version: 1,
					name: entry.foundation.name,
					aliases: entry.foundation.aliases,
					description: entry.foundation.description,
					confidence: entry.foundation.confidence,
				});
				results.push({
					entityId: entity.id,
					language: LANG,
					source: "urantia.dev",
					version: 1,
					name: entry.urantia_dev.name,
					aliases: entry.urantia_dev.aliases,
					description: entry.urantia_dev.description,
					confidence: entry.urantia_dev.confidence,
				});
			} else {
				// Fallback — mark for manual review
				results.push({
					entityId: entity.id, language: LANG, source: "foundation", version: 1,
					name: entity.name, aliases: null, description: "", confidence: "needs_manual",
				});
				results.push({
					entityId: entity.id, language: LANG, source: "urantia.dev", version: 1,
					name: entity.name, aliases: null, description: "", confidence: "needs_manual",
				});
			}
		}
		return results;
	} catch (err) {
		console.error("  Parse error:", (err as Error).message);
		console.error("  Response length:", rawText.length, "| stop_reason:", response.stop_reason);
		return batch.flatMap((entity) => [
			{ entityId: entity.id, language: LANG, source: "foundation", version: 1, name: entity.name, aliases: null, description: "", confidence: "needs_manual" },
			{ entityId: entity.id, language: LANG, source: "urantia.dev", version: 1, name: entity.name, aliases: null, description: "", confidence: "needs_manual" },
		]);
	}
}

// --- Main ---
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

const allEntities: SeedEntity[] = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
const entitiesToProcess = limit ? allEntities.slice(0, limit) : allEntities;

console.log("=== Translate Entities to ${LANG_NAMES[LANG]} (${LANG}) ===\n");
console.log(`Processing ${entitiesToProcess.length} entities${limit ? ` (limited from ${allEntities.length})` : ""}\n`);

// Load existing translations for resumability
let translations: TranslationEntry[] = [];
const processedIds = new Set<string>();
if (existsSync(OUTPUT_PATH)) {
	translations = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
	for (const t of translations) processedIds.add(t.entityId);
	console.log(`Resuming: ${processedIds.size} entities already translated\n`);
}

const unprocessed = entitiesToProcess.filter((e) => !processedIds.has(e.id));

async function main() {
	const totalBatches = Math.ceil(unprocessed.length / BATCH_SIZE);

	for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
		const batch = unprocessed.slice(i, i + BATCH_SIZE);
		const batchNum = Math.floor(i / BATCH_SIZE) + 1;
		console.log(`Batch ${batchNum}/${totalBatches}: ${batch.map((b) => b.name).join(", ")}`);

		const results = await translateBatch(batch);
		translations.push(...results);
		writeFileSync(OUTPUT_PATH, JSON.stringify(translations, null, 2));
	}

	// Summary
	const foundation = translations.filter((t) => t.source === "foundation");
	const urantia = translations.filter((t) => t.source === "urantia.dev");
	const high = translations.filter((t) => t.confidence === "high").length;
	const medium = translations.filter((t) => t.confidence === "medium").length;
	const needsManual = translations.filter((t) => t.confidence === "needs_manual").length;

	console.log(`\n--- Translation Complete ---`);
	console.log(`  Total entries:       ${translations.length} (${foundation.length} foundation + ${urantia.length} urantia.dev)`);
	console.log(`  Unique entities:     ${processedIds.size + unprocessed.length}`);
	console.log(`  High confidence:     ${high}`);
	console.log(`  Medium confidence:   ${medium}`);
	console.log(`  Needs manual:        ${needsManual}`);
	console.log(`\nOutput: ${OUTPUT_PATH}`);
}

main().catch((err) => {
	console.error("Translation failed:", err);
	process.exit(1);
});
