/**
 * compare-models.ts — Side-by-side Haiku vs Sonnet translation comparison
 *
 * Usage:
 *   bun scripts/translate/compare-models.ts --ref=3:2.8 --lang=es
 *   bun scripts/translate/compare-models.ts --ref=3:2.8 --lang=es --entity=machiventa-melchizedek
 *
 * Translates a paragraph (and optionally an entity) with both Claude Haiku and
 * Claude Sonnet, showing quality and cost side-by-side so you can pick a model
 * for the full pipeline.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// --- Config ---
const ROOT = join(import.meta.dir, "../..");
const URANTIAPEDIA = join(ROOT, "../misc/urantiapedia/input/json");
const SEED_PATH = join(ROOT, "data/entities/seed-entities.json");

const MODELS = {
	haiku: "claude-haiku-4-5-20251001",
	sonnet: "claude-sonnet-4-20250514",
} as const;

// Pricing per million tokens (as of March 2026)
const PRICING: Record<string, { input: number; output: number }> = {
	haiku: { input: 0.80, output: 4.00 },
	sonnet: { input: 3.00, output: 15.00 },
};

const LANG_NAMES: Record<string, string> = {
	nl: "Dutch", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", ko: "Korean",
};

// --- Parse args ---
const refArg = process.argv.find((a) => a.startsWith("--ref="));
const langArg = process.argv.find((a) => a.startsWith("--lang="));
const entityArg = process.argv.find((a) => a.startsWith("--entity="));

const REF = refArg?.split("=")[1] ?? "3:2.8";
const LANG = langArg?.split("=")[1] ?? "es";
const ENTITY_ID = entityArg?.split("=")[1] ?? "machiventa-melchizedek";

if (!LANG_NAMES[LANG]) {
	console.error(`Unsupported language: ${LANG}. Supported: ${Object.keys(LANG_NAMES).join(", ")}`);
	process.exit(1);
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
	console.error("ANTHROPIC_API_KEY environment variable is required");
	process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// --- Types ---
type UrantiapediaParagraph = { par_ref: string; par_content: string };
type UrantiapediaSection = { section_index: number; pars: UrantiapediaParagraph[] };
type UrantiapediaPaper = { paper_index: number; sections: UrantiapediaSection[] };

type SeedEntity = {
	id: string;
	name: string;
	type: string;
	aliases: string[];
	description: string;
	seeAlso: string[];
	citations: string[];
};

// --- Helpers ---
function loadPaper(lang: string, paperIndex: number): UrantiapediaPaper | null {
	const padded = String(paperIndex).padStart(3, "0");
	try {
		return JSON.parse(readFileSync(join(URANTIAPEDIA, `book-${lang}`, `Doc${padded}.json`), "utf-8"));
	} catch {
		return null;
	}
}

function findParagraph(paper: UrantiapediaPaper, ref: string): string | null {
	for (const s of paper.sections) {
		for (const p of s.pars) {
			if (p.par_ref === ref) return p.par_content;
		}
	}
	return null;
}

function parsePaperNumber(ref: string): number {
	return Number(ref.split(":")[0]);
}

function estimateCost(model: "haiku" | "sonnet", inputTokens: number, outputTokens: number): string {
	const pricing = PRICING[model]!;
	const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
	return `$${cost.toFixed(4)}`;
}

function estimateFullCost(model: "haiku" | "sonnet", inputTokens: number, outputTokens: number, totalParagraphs: number): string {
	const pricing = PRICING[model]!;
	const costPerParagraph = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
	const totalCost = costPerParagraph * totalParagraphs;
	return `$${totalCost.toFixed(2)}`;
}

// --- Load data ---
const paperNum = parsePaperNumber(REF);
const enPaper = loadPaper("en", paperNum);
const targetPaper = loadPaper(LANG, paperNum);

if (!enPaper) {
	console.error(`Could not load English paper ${paperNum} from Urantiapedia`);
	process.exit(1);
}

const enText = findParagraph(enPaper, REF);
if (!enText) {
	console.error(`Could not find paragraph ${REF} in English paper ${paperNum}`);
	process.exit(1);
}

const foundationText = targetPaper ? findParagraph(targetPaper, REF) : null;

// Load entity
const allEntities: SeedEntity[] = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
const entity = allEntities.find((e) => e.id === ENTITY_ID);

// --- Build prompts ---
function buildParagraphPrompt(enText: string, foundationRef: string | null): string {
	let prompt = `Translate the following paragraph from the Urantia Book from English to ${LANG_NAMES[LANG]}.

Your translation should be:
- Natural and modern — readable to a native ${LANG_NAMES[LANG]} speaker
- Faithful to the meaning and spiritual/philosophical tone of the original
- Superior in clarity and readability compared to existing translations
- Independent — do not paraphrase any existing translation

Proper nouns that are Urantia Book coinages (Melchizedek, Urantia, Nebadon, Havona, etc.) should typically remain unchanged unless there is a well-established ${LANG_NAMES[LANG]} convention for them.

English paragraph (${REF}):
"${enText}"`;

	if (foundationRef) {
		prompt += `

For reference only (do NOT copy or paraphrase — produce your own superior translation):
Foundation ${LANG_NAMES[LANG]} translation: "${foundationRef}"`;
	}

	prompt += `

Respond with ONLY the translated paragraph text, no quotes or explanation.`;
	return prompt;
}

function buildEntityPrompt(entity: SeedEntity): string {
	return `Translate this Urantia Book entity from English to ${LANG_NAMES[LANG]}.

Entity: "${entity.name}" (type: ${entity.type})
Aliases: ${entity.aliases.length > 0 ? entity.aliases.join(", ") : "(none)"}
Description: "${entity.description}"

Your translation should be natural, accurate, and superior to existing translations.
Proper nouns that are Urantia Book coinages typically stay the same across languages.

Respond with ONLY valid JSON (no markdown):
{
  "name": "translated name",
  "aliases": ["translated aliases"] or null,
  "description": "translated description (same detail level as original)",
  "confidence": "high" or "medium" or "needs_manual"
}`;
}

// --- Run comparisons ---
type TranslationResult = {
	model: string;
	text: string;
	inputTokens: number;
	outputTokens: number;
	cost: string;
	durationMs: number;
};

async function translate(modelKey: "haiku" | "sonnet", prompt: string): Promise<TranslationResult> {
	const start = Date.now();
	const response = await client.messages.create({
		model: MODELS[modelKey],
		max_tokens: 4096,
		messages: [{ role: "user", content: prompt }],
	});

	const text = response.content[0]?.type === "text" ? response.content[0].text : "";
	const inputTokens = response.usage.input_tokens;
	const outputTokens = response.usage.output_tokens;

	return {
		model: modelKey,
		text,
		inputTokens,
		outputTokens,
		cost: estimateCost(modelKey, inputTokens, outputTokens),
		durationMs: Date.now() - start,
	};
}

async function main() {
	console.log(`\n${"=".repeat(80)}`);
	console.log(`  MODEL COMPARISON: Haiku vs Sonnet`);
	console.log(`  Paragraph: ${REF} | Language: ${LANG_NAMES[LANG]} (${LANG})`);
	console.log(`${"=".repeat(80)}\n`);

	// --- Paragraph translation ---
	console.log(`--- English (${REF}) ---`);
	console.log(enText);
	console.log();

	if (foundationText) {
		console.log(`--- Foundation ${LANG_NAMES[LANG]} (reference) ---`);
		console.log(foundationText);
		console.log();
	} else {
		console.log(`(No Foundation ${LANG_NAMES[LANG]} translation available for reference)\n`);
	}

	const paragraphPrompt = buildParagraphPrompt(enText, foundationText);

	console.log("Translating paragraph with both models...\n");
	const [haikuPara, sonnetPara] = await Promise.all([
		translate("haiku", paragraphPrompt),
		translate("sonnet", paragraphPrompt),
	]);

	console.log(`--- Haiku Translation ---`);
	console.log(haikuPara.text);
	console.log(`\n  Tokens: ${haikuPara.inputTokens} in / ${haikuPara.outputTokens} out | Cost: ${haikuPara.cost} | Time: ${haikuPara.durationMs}ms\n`);

	console.log(`--- Sonnet Translation ---`);
	console.log(sonnetPara.text);
	console.log(`\n  Tokens: ${sonnetPara.inputTokens} in / ${sonnetPara.outputTokens} out | Cost: ${sonnetPara.cost} | Time: ${sonnetPara.durationMs}ms\n`);

	// --- Entity translation ---
	if (entity) {
		console.log(`${"=".repeat(80)}`);
		console.log(`  ENTITY: ${entity.name} (${entity.id})`);
		console.log(`${"=".repeat(80)}\n`);

		console.log(`English: ${entity.name}`);
		console.log(`Description: ${entity.description}`);
		console.log(`Aliases: ${entity.aliases.length > 0 ? entity.aliases.join(", ") : "(none)"}`);
		console.log();

		const entityPrompt = buildEntityPrompt(entity);

		console.log("Translating entity with both models...\n");
		const [haikuEntity, sonnetEntity] = await Promise.all([
			translate("haiku", entityPrompt),
			translate("sonnet", entityPrompt),
		]);

		console.log(`--- Haiku Entity ---`);
		console.log(haikuEntity.text);
		console.log(`\n  Tokens: ${haikuEntity.inputTokens} in / ${haikuEntity.outputTokens} out | Cost: ${haikuEntity.cost} | Time: ${haikuEntity.durationMs}ms\n`);

		console.log(`--- Sonnet Entity ---`);
		console.log(sonnetEntity.text);
		console.log(`\n  Tokens: ${sonnetEntity.inputTokens} in / ${sonnetEntity.outputTokens} out | Cost: ${sonnetEntity.cost} | Time: ${sonnetEntity.durationMs}ms\n`);
	}

	// --- Cost projection ---
	console.log(`${"=".repeat(80)}`);
	console.log(`  COST PROJECTION (full pipeline)`);
	console.log(`${"=".repeat(80)}\n`);

	const TOTAL_PARAGRAPHS = 16_000;
	const TOTAL_ENTITIES = 3_000;
	const LANGUAGES = 5;

	console.log(`  Paragraphs: ~${TOTAL_PARAGRAPHS.toLocaleString()} × ${LANGUAGES} languages = ${(TOTAL_PARAGRAPHS * LANGUAGES).toLocaleString()} translations`);
	console.log(`  Entities:   ~${TOTAL_ENTITIES.toLocaleString()} × ${LANGUAGES} languages = ${(TOTAL_ENTITIES * LANGUAGES).toLocaleString()} translations\n`);

	console.log(`  ${"Model".padEnd(10)} ${"Paragraphs".padEnd(15)} ${"Entities".padEnd(15)} ${"Total".padEnd(15)}`);
	console.log(`  ${"-".repeat(55)}`);

	for (const modelKey of ["haiku", "sonnet"] as const) {
		const paraResult = modelKey === "haiku" ? haikuPara : sonnetPara;
		const paraCost = estimateFullCost(modelKey, paraResult.inputTokens, paraResult.outputTokens, TOTAL_PARAGRAPHS * LANGUAGES);

		// Entity cost estimate (entities are shorter, use roughly 1/3 the tokens)
		const entityInputEst = Math.round(paraResult.inputTokens * 0.4);
		const entityOutputEst = Math.round(paraResult.outputTokens * 0.3);
		const entityCost = estimateFullCost(modelKey, entityInputEst, entityOutputEst, TOTAL_ENTITIES * LANGUAGES);

		const pricing = PRICING[modelKey]!;
		const totalParaCost = (paraResult.inputTokens * pricing.input + paraResult.outputTokens * pricing.output) / 1_000_000 * TOTAL_PARAGRAPHS * LANGUAGES;
		const totalEntityCost = (entityInputEst * pricing.input + entityOutputEst * pricing.output) / 1_000_000 * TOTAL_ENTITIES * LANGUAGES;
		const total = `$${(totalParaCost + totalEntityCost).toFixed(2)}`;

		console.log(`  ${modelKey.padEnd(10)} ${paraCost.padEnd(15)} ${entityCost.padEnd(15)} ${total.padEnd(15)}`);
	}

	console.log(`\n  Note: These are rough estimates based on a single paragraph's token usage.`);
	console.log(`  Batching (20-50 per call) will reduce per-paragraph overhead significantly.\n`);
}

main().catch((err) => {
	console.error("Comparison failed:", err);
	process.exit(1);
});
