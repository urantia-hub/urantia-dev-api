/**
 * translate-paragraphs.ts — Translate Urantia Book paragraphs to target languages
 *
 * Usage:
 *   bun scripts/translate/translate-paragraphs.ts --lang=es
 *   bun scripts/translate/translate-paragraphs.ts --lang=es --paper=93
 *   bun scripts/translate/translate-paragraphs.ts --lang=es --paper=93 --limit=5
 *   bun scripts/translate/translate-paragraphs.ts --lang=es --dry-run
 *
 * Uses Claude Haiku for cost-effective paragraph translation.
 * Entity glossary is injected as a hard constraint for consistent terminology.
 * Foundation parallel text is used as reference context only.
 * Idempotent: resumes from output files, skips already-translated paragraphs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = join(import.meta.dir, "../..");
const DATA_DIR = join(ROOT, "../misc/urantia-papers-json/data/json/eng");
const URANTIAPEDIA = join(ROOT, "../misc/urantiapedia/input/json");

const MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 20; // paragraphs per API call

const LANG_NAMES: Record<string, string> = {
	nl: "Dutch", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", ko: "Korean",
};

// --- Parse args ---
const langArg = process.argv.find((a) => a.startsWith("--lang="));
const LANG = langArg ? langArg.split("=")[1]! : "";
if (!LANG || !Object.keys(LANG_NAMES).includes(LANG)) {
	console.error(`Usage: bun scripts/translate/translate-paragraphs.ts --lang=${Object.keys(LANG_NAMES).join("|")} [--paper=N] [--limit=N] [--dry-run]`);
	process.exit(1);
}

const paperArg = process.argv.find((a) => a.startsWith("--paper="));
const PAPER_FILTER = paperArg ? Number(paperArg.split("=")[1]) : null;

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : undefined;

const DRY_RUN = process.argv.includes("--dry-run");

const GLOSSARY_PATH = join(ROOT, `data/translations/${LANG}/term-glossary.json`);
const OUTPUT_DIR = join(ROOT, `data/translations/${LANG}/paragraphs`);

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
	text: string | null;
	htmlText: string | null;
	standardReferenceId: string | null;
	paperSectionParagraphId: string | null;
	paperId: string | null;
	paperTitle: string | null;
	sectionTitle: string | null;
	type: string;
	sortId: string;
};

type ParagraphTranslation = {
	paragraphId: string; // matches paragraphs.id in DB (the objectID)
	globalId: string;
	standardReferenceId: string;
	language: string;
	version: number;
	text: string;
	htmlText: string;
	source: string;
	confidence: string;
};

type UrantiapediaParagraph = { par_ref: string; par_content: string };
type UrantiapediaSection = { section_index: number; pars: UrantiapediaParagraph[] };
type UrantiapediaPaper = { paper_index: number; sections: UrantiapediaSection[] };

// --- Load entity glossary ---
let glossary: Record<string, string> = {};
if (existsSync(GLOSSARY_PATH)) {
	glossary = JSON.parse(readFileSync(GLOSSARY_PATH, "utf-8"));
	console.log(`Entity glossary loaded: ${Object.keys(glossary).length} terms`);
} else {
	console.warn(`No glossary at ${GLOSSARY_PATH} — entity names won't be constrained`);
	console.warn(`Run build-term-glossary.ts --lang=${LANG} first for best results.\n`);
}

// Build a concise glossary string for the prompt (only translated terms)
const glossaryEntries = Object.entries(glossary).filter(([en, tr]) => en !== tr);
const glossaryText = glossaryEntries.length > 0
	? glossaryEntries.map(([en, tr]) => `"${en}" → "${tr}"`).join("\n")
	: "(no translated terms)";

// --- Load Urantiapedia paper (Foundation reference) ---
const urantiapediaCache = new Map<number, UrantiapediaPaper>();

function loadUrantiapediaPaper(paperNum: number): UrantiapediaPaper | null {
	if (urantiapediaCache.has(paperNum)) return urantiapediaCache.get(paperNum)!;
	const padded = String(paperNum).padStart(3, "0");
	try {
		const data = JSON.parse(readFileSync(join(URANTIAPEDIA, `book-${LANG}`, `Doc${padded}.json`), "utf-8"));
		urantiapediaCache.set(paperNum, data);
		return data;
	} catch {
		return null;
	}
}

function findUrantiapediaParagraph(paper: UrantiapediaPaper, ref: string): string | null {
	for (const s of paper.sections) {
		for (const p of s.pars) {
			if (p.par_ref === ref) return p.par_content;
		}
	}
	return null;
}

// --- Load English paragraphs ---
function loadPaperParagraphs(paperNum: number): RawJsonNode[] {
	const padded = String(paperNum).padStart(3, "0");
	const filePath = join(DATA_DIR, `${padded}.json`);
	if (!existsSync(filePath)) return [];
	const nodes: RawJsonNode[] = JSON.parse(readFileSync(filePath, "utf-8"));
	return nodes.filter((n) => n.type === "paragraph" && n.text && n.htmlText);
}

function getPaperNumbers(): number[] {
	const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();
	return files.map((f) => Number(f.replace(".json", "")));
}

// --- Load existing translations for a paper ---
function getOutputPath(paperNum: number): string {
	return join(OUTPUT_DIR, `paper-${String(paperNum).padStart(3, "0")}.json`);
}

function loadExistingTranslations(paperNum: number): Map<string, ParagraphTranslation> {
	const path = getOutputPath(paperNum);
	if (!existsSync(path)) return new Map();
	const entries: ParagraphTranslation[] = JSON.parse(readFileSync(path, "utf-8"));
	return new Map(entries.map((e) => [e.standardReferenceId, e]));
}

// --- Build system prompt (shared across all batches for a paper) ---
function buildSystemPrompt(): string {
	let prompt = `You are translating paragraphs from the Urantia Book from English to ${LANG_NAMES[LANG]}.

Your translations must be:
- Natural and modern — readable to a native ${LANG_NAMES[LANG]} speaker
- Faithful to the meaning and spiritual/philosophical tone of the original
- Superior in clarity and readability compared to existing translations
- Independent — do not copy or paraphrase any existing translation`;

	if (glossaryEntries.length > 0) {
		prompt += `

MANDATORY ENTITY GLOSSARY — You MUST use these exact translations for entity names:
${glossaryText}

Entity names NOT in this list should remain unchanged (they are proper nouns).`;
	}

	prompt += `

For each paragraph, produce ONLY valid JSON with:
- "ref": the reference ID (e.g. "3:2.8")
- "text": the translated plain text
- "htmlText": the translated HTML text (preserve all HTML tags and classes from the original)

Respond with a JSON array. No markdown fences, no explanation.`;

	return prompt;
}

// --- Translate a batch ---
async function translateBatch(
	batch: RawJsonNode[],
	paperNum: number,
	systemPrompt: string,
): Promise<ParagraphTranslation[]> {
	const urantiapediaPaper = loadUrantiapediaPaper(paperNum);

	const paragraphsContext = batch.map((para, i) => {
		const ref = para.standardReferenceId!;
		const foundationText = urantiapediaPaper
			? findUrantiapediaParagraph(urantiapediaPaper, ref)
			: null;

		let ctx = `[${i + 1}] ref: "${ref}"
English text: "${para.text}"
English htmlText: "${para.htmlText}"`;

		if (foundationText) {
			ctx += `\nFoundation ${LANG_NAMES[LANG]} (reference only — do NOT copy): "${foundationText}"`;
		}

		return ctx;
	}).join("\n\n---\n\n");

	const response = await callWithRetry(() => client!.messages.create({
		model: MODEL,
		max_tokens: 16384,
		system: systemPrompt,
		messages: [{
			role: "user",
			content: `Translate these ${batch.length} paragraphs to ${LANG_NAMES[LANG]}:\n\n${paragraphsContext}`,
		}],
	}));

	const rawText = response.content[0]?.type === "text" ? response.content[0].text : "";
	const text = rawText.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

	try {
		let parsed: Array<{ ref: string; text: string; htmlText: string }>;
		try {
			parsed = JSON.parse(text);
		} catch {
			// Try to extract individual objects
			const objects: typeof parsed = [];
			const matches = text.matchAll(/\{[^{}]*"ref"\s*:\s*"([^"]+)"[^]*?"htmlText"\s*:\s*"[^"]*"\s*\}/g);
			for (const match of matches) {
				try { objects.push(JSON.parse(match[0])); } catch { /* skip */ }
			}
			if (objects.length === 0) throw new Error("No valid objects found in response");
			parsed = objects;
		}

		const results: ParagraphTranslation[] = [];
		for (const para of batch) {
			const ref = para.standardReferenceId!;
			const entry = parsed.find((e) => e.ref === ref);
			if (entry) {
				results.push({
					paragraphId: para.globalId.replace(/:/g, "-").replace(/\./g, "-"), // matches DB id format
					globalId: para.globalId,
					standardReferenceId: ref,
					language: LANG,
					version: 1,
					text: entry.text,
					htmlText: entry.htmlText,
					source: "urantia.dev",
					confidence: "high",
				});
			} else {
				results.push({
					paragraphId: para.globalId.replace(/:/g, "-").replace(/\./g, "-"),
					globalId: para.globalId,
					standardReferenceId: ref,
					language: LANG,
					version: 1,
					text: "",
					htmlText: "",
					source: "urantia.dev",
					confidence: "needs_review",
				});
			}
		}
		return results;
	} catch (err) {
		console.error("  Parse error:", (err as Error).message);
		console.error("  Response length:", rawText.length, "| stop_reason:", response.stop_reason);
		return batch.map((para) => ({
			paragraphId: para.globalId.replace(/:/g, "-").replace(/\./g, "-"),
			globalId: para.globalId,
			standardReferenceId: para.standardReferenceId!,
			language: LANG,
			version: 1,
			text: "",
			htmlText: "",
			source: "urantia.dev",
			confidence: "needs_review",
		}));
	}
}

// --- Main ---
console.log(`\n=== Translate Paragraphs to ${LANG_NAMES[LANG]} (${LANG}) ===`);
console.log(`Model: ${MODEL}`);
if (PAPER_FILTER !== null) console.log(`Paper filter: ${PAPER_FILTER}`);
if (LIMIT) console.log(`Limit: ${LIMIT} paragraphs`);
if (DRY_RUN) console.log("DRY RUN — no API calls will be made");
console.log();

// Determine which papers to process
const allPaperNums = PAPER_FILTER !== null ? [PAPER_FILTER] : getPaperNumbers();
mkdirSync(OUTPUT_DIR, { recursive: true });

const systemPrompt = buildSystemPrompt();
let totalTranslated = 0;
let totalSkipped = 0;
let totalParagraphs = 0;

async function main() {
	for (const paperNum of allPaperNums) {
		const paragraphs = loadPaperParagraphs(paperNum);
		if (paragraphs.length === 0) continue;

		totalParagraphs += paragraphs.length;

		// Load existing translations for this paper
		const existing = loadExistingTranslations(paperNum);
		const unprocessed = paragraphs.filter((p) => !existing.has(p.standardReferenceId!));

		// Apply limit
		const toProcess = LIMIT ? unprocessed.slice(0, LIMIT - totalTranslated) : unprocessed;
		if (toProcess.length === 0) {
			totalSkipped += paragraphs.length;
			continue;
		}

		totalSkipped += existing.size;

		if (DRY_RUN) {
			console.log(`Paper ${paperNum}: ${toProcess.length} to translate (${existing.size} already done, ${paragraphs.length} total)`);
			totalTranslated += toProcess.length;
			if (LIMIT && totalTranslated >= LIMIT) break;
			continue;
		}

		console.log(`Paper ${paperNum}: translating ${toProcess.length} paragraphs (${existing.size} already done)`);

		// Translate in batches
		const allTranslations = [...existing.values()];
		for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
			const batch = toProcess.slice(i, i + BATCH_SIZE);
			const batchNum = Math.floor(i / BATCH_SIZE) + 1;
			const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
			console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} paragraphs)`);

			const results = await translateBatch(batch, paperNum, systemPrompt);
			allTranslations.push(...results);
			totalTranslated += results.length;

			// Save after each batch
			writeFileSync(getOutputPath(paperNum), JSON.stringify(allTranslations, null, 2));

			const needsReview = results.filter((r) => r.confidence === "needs_review").length;
			if (needsReview > 0) {
				console.log(`    ⚠ ${needsReview} paragraphs need review`);
			}
		}

		if (LIMIT && totalTranslated >= LIMIT) break;
	}

	// Summary
	console.log(`\n--- Translation Summary ---`);
	console.log(`  Papers processed: ${allPaperNums.length}`);
	console.log(`  Total paragraphs: ${totalParagraphs}`);
	console.log(`  Translated:       ${totalTranslated}`);
	console.log(`  Skipped (done):   ${totalSkipped}`);
	console.log(`\nOutput: ${OUTPUT_DIR}`);
}

main().catch((err) => {
	console.error("Translation failed:", err);
	process.exit(1);
});
