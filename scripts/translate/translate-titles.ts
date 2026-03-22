/**
 * translate-titles.ts — Translate paper and section titles to target languages
 *
 * Usage:
 *   bun scripts/translate/translate-titles.ts --lang=es
 *   bun scripts/translate/translate-titles.ts --lang=es --dry-run
 *
 * Uses Claude Haiku. Much smaller job than paragraphs (~200 papers + ~1,200 sections).
 * Entity glossary is used for consistent terminology.
 * Idempotent: resumes from output file.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = join(import.meta.dir, "../..");
const DATA_DIR = join(ROOT, "../misc/urantia-papers-json/data/json/eng");

const MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 50; // titles per API call

const LANG_NAMES: Record<string, string> = {
	nl: "Dutch", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", ko: "Korean",
};

// --- Parse args ---
const langArg = process.argv.find((a) => a.startsWith("--lang="));
const LANG = langArg ? langArg.split("=")[1]! : "";
if (!LANG || !Object.keys(LANG_NAMES).includes(LANG)) {
	console.error(`Usage: bun scripts/translate/translate-titles.ts --lang=${Object.keys(LANG_NAMES).join("|")} [--dry-run]`);
	process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

const GLOSSARY_PATH = join(ROOT, `data/translations/${LANG}/term-glossary.json`);
const OUTPUT_PATH = join(ROOT, `data/translations/${LANG}/titles.json`);

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
type RawJsonNode = {
	globalId: string;
	type: string;
	paperTitle: string | null;
	sectionTitle: string | null;
	paperId: string | null;
	sectionId: string | null;
};

type TitleTranslation = {
	sourceType: "paper" | "section";
	sourceId: string;
	englishTitle: string;
	language: string;
	version: number;
	title: string;
	source: string;
	confidence: string;
};

// --- Load glossary ---
let glossary: Record<string, string> = {};
if (existsSync(GLOSSARY_PATH)) {
	glossary = JSON.parse(readFileSync(GLOSSARY_PATH, "utf-8"));
}

const glossaryEntries = Object.entries(glossary).filter(([en, tr]) => en !== tr);
const glossaryText = glossaryEntries.length > 0
	? glossaryEntries.map(([en, tr]) => `"${en}" → "${tr}"`).join("\n")
	: "";

// --- Extract titles from source data ---
type TitleEntry = { type: "paper" | "section"; id: string; title: string };

function extractTitles(): TitleEntry[] {
	const titles: TitleEntry[] = [];
	const seenPapers = new Set<string>();
	const seenSections = new Set<string>();

	const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();
	for (const file of files) {
		const nodes: RawJsonNode[] = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8"));

		for (const node of nodes) {
			if (node.type === "paper" && node.paperTitle && node.paperId && !seenPapers.has(node.paperId)) {
				seenPapers.add(node.paperId);
				titles.push({ type: "paper", id: node.paperId, title: node.paperTitle });
			}
			if (node.type === "section" && node.sectionTitle && node.sectionId && !seenSections.has(node.sectionId)) {
				seenSections.add(node.sectionId);
				titles.push({ type: "section", id: node.sectionId, title: node.sectionTitle });
			}
		}
	}

	return titles;
}

// --- Translate batch ---
async function translateTitleBatch(batch: TitleEntry[]): Promise<TitleTranslation[]> {
	const context = batch.map((t, i) =>
		`[${i + 1}] ${t.type}: id="${t.id}" title="${t.title}"`
	).join("\n");

	let systemPrompt = `You are translating Urantia Book paper and section titles from English to ${LANG_NAMES[LANG]}.

Your translations should be natural and readable in ${LANG_NAMES[LANG]}.`;

	if (glossaryText) {
		systemPrompt += `

Use these entity name translations where applicable:
${glossaryText}`;
	}

	systemPrompt += `

Respond with ONLY a JSON array — no markdown:
[{ "id": "source-id", "title": "translated title" }]`;

	const response = await callWithRetry(() => client!.messages.create({
		model: MODEL,
		max_tokens: 8192,
		system: systemPrompt,
		messages: [{ role: "user", content: `Translate these ${batch.length} titles:\n\n${context}` }],
	}));

	const rawText = response.content[0]?.type === "text" ? response.content[0].text : "";
	const text = rawText.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

	try {
		const parsed: Array<{ id: string; title: string }> = JSON.parse(text);
		return batch.map((t) => {
			const entry = parsed.find((p) => p.id === t.id);
			return {
				sourceType: t.type,
				sourceId: t.id,
				englishTitle: t.title,
				language: LANG,
				version: 1,
				title: entry?.title ?? t.title,
				source: "urantia.dev",
				confidence: entry ? "high" : "needs_review",
			};
		});
	} catch (err) {
		console.error("  Parse error:", (err as Error).message);
		return batch.map((t) => ({
			sourceType: t.type,
			sourceId: t.id,
			englishTitle: t.title,
			language: LANG,
			version: 1,
			title: t.title,
			source: "urantia.dev",
			confidence: "needs_review",
		}));
	}
}

// --- Main ---
console.log(`\n=== Translate Titles to ${LANG_NAMES[LANG]} (${LANG}) ===`);
console.log(`Model: ${MODEL}`);
if (DRY_RUN) console.log("DRY RUN — no API calls\n");

const allTitles = extractTitles();
const paperTitles = allTitles.filter((t) => t.type === "paper");
const sectionTitles = allTitles.filter((t) => t.type === "section");
console.log(`Found ${paperTitles.length} paper titles + ${sectionTitles.length} section titles = ${allTitles.length} total\n`);

// Load existing translations for resumability
let translations: TitleTranslation[] = [];
const processedIds = new Set<string>();

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

if (existsSync(OUTPUT_PATH)) {
	translations = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
	for (const t of translations) processedIds.add(`${t.sourceType}:${t.sourceId}`);
	console.log(`Resuming: ${processedIds.size} titles already translated\n`);
}

const unprocessed = allTitles.filter((t) => !processedIds.has(`${t.type}:${t.id}`));

if (unprocessed.length === 0) {
	console.log("All titles already translated.");
	process.exit(0);
}

console.log(`${unprocessed.length} titles to translate\n`);

if (DRY_RUN) {
	console.log(`Would translate ${unprocessed.length} titles in ${Math.ceil(unprocessed.length / BATCH_SIZE)} batches.`);
	process.exit(0);
}

async function main() {
	const totalBatches = Math.ceil(unprocessed.length / BATCH_SIZE);

	for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
		const batch = unprocessed.slice(i, i + BATCH_SIZE);
		const batchNum = Math.floor(i / BATCH_SIZE) + 1;
		console.log(`Batch ${batchNum}/${totalBatches}: ${batch.length} titles`);

		const results = await translateTitleBatch(batch);
		translations.push(...results);
		writeFileSync(OUTPUT_PATH, JSON.stringify(translations, null, 2));
	}

	const needsReview = translations.filter((t) => t.confidence === "needs_review").length;
	console.log(`\n--- Title Translation Complete ---`);
	console.log(`  Total: ${translations.length}`);
	console.log(`  Papers: ${translations.filter((t) => t.sourceType === "paper").length}`);
	console.log(`  Sections: ${translations.filter((t) => t.sourceType === "section").length}`);
	if (needsReview > 0) console.log(`  Needs review: ${needsReview}`);
	console.log(`\nOutput: ${OUTPUT_PATH}`);
}

main().catch((err) => {
	console.error("Title translation failed:", err);
	process.exit(1);
});
