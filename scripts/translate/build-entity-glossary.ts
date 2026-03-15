import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = join(import.meta.dir, "../..");
const PAIRS_PATH = join(ROOT, "data/translations/nl/entity-pairs.json");
const OUTPUT_PATH = join(ROOT, "data/translations/nl/entity-glossary.json");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
	console.error("ANTHROPIC_API_KEY environment variable is required");
	process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

type EntityPair = {
	entityId: string;
	entityName: string;
	entityType: string;
	aliases: string[];
	citationRef: string;
	en: string;
	nl: string;
};

type EntityNoCitation = {
	entityId: string;
	entityName: string;
	entityType: string;
	aliases: string[];
	description: string;
};

type PairsFile = {
	metadata: Record<string, number | string>;
	pairs: EntityPair[];
	noCitations: EntityNoCitation[];
};

type GlossaryEntry = {
	entityId: string;
	entityType: string;
	aliases: string[];
	foundation: string;
	urantia_dev: string;
	confidence: "high" | "medium" | "needs_manual";
	source_ref: string | null;
};

type Glossary = Record<string, GlossaryEntry>;

if (!existsSync(PAIRS_PATH)) {
	console.error(`Entity pairs file not found at ${PAIRS_PATH}`);
	console.error("Run extract-entity-pairs.ts first.");
	process.exit(1);
}

const pairsData: PairsFile = JSON.parse(readFileSync(PAIRS_PATH, "utf-8"));
console.log("=== Build Entity Glossary (Dutch) ===\n");
console.log(`Loaded ${pairsData.pairs.length} entity pairs + ${pairsData.noCitations.length} no-citation entities`);

// Load existing glossary for resumability
let glossary: Glossary = {};
if (existsSync(OUTPUT_PATH)) {
	glossary = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
	console.log(`Resuming: ${Object.keys(glossary).length} entries already in glossary`);
}

const BATCH_SIZE = 20;

async function processPairsBatch(batch: EntityPair[]): Promise<Glossary> {
	const entitiesContext = batch
		.map(
			(p, i) =>
				`[${i + 1}] Entity: "${p.entityName}" (type: ${p.entityType}${p.aliases.length > 0 ? `, aliases: ${p.aliases.join(", ")}` : ""})
Citation: ${p.citationRef}
English paragraph: "${p.en}"
Dutch paragraph (Urantia Foundation translation): "${p.nl}"`,
		)
		.join("\n\n---\n\n");

	const response = await client.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 4096,
		system: `You are an expert translator specializing in The Urantia Book. You analyze English and Dutch paragraph pairs to identify how specific entity names are translated.

For each entity, you must provide:
1. "foundation": The exact Dutch term used in the Foundation's Dutch translation (extracted from the Dutch paragraph provided)
2. "urantia_dev": Your own independent Dutch translation of the entity name. This should be a natural, accurate Dutch rendering. It may be the same as the Foundation translation if that translation is the most natural choice.
3. "confidence": "high" if the entity name clearly appears in both paragraphs, "medium" if you had to infer, "needs_manual" if uncertain

Important:
- For proper nouns (names of beings, places) that don't change in Dutch, use the same name for both foundation and urantia_dev
- For translated concepts (like "Life Carriers" → "Levendragers"), carefully identify the exact Dutch rendering
- If the entity name doesn't clearly appear in the provided paragraph, still try your best based on context

Respond with ONLY valid JSON — no markdown, no explanation. Format:
{
  "EntityNameInEnglish": {
    "foundation": "Dutch term from Foundation",
    "urantia_dev": "Your independent Dutch translation",
    "confidence": "high|medium|needs_manual"
  }
}`,
		messages: [
			{
				role: "user",
				content: `Identify the Dutch translations for each of these ${batch.length} entities:\n\n${entitiesContext}`,
			},
		],
	});

	const text =
		response.content[0]?.type === "text" ? response.content[0].text : "";

	try {
		const parsed = JSON.parse(text);
		const result: Glossary = {};
		for (const pair of batch) {
			const entry = parsed[pair.entityName];
			if (entry) {
				result[pair.entityName] = {
					entityId: pair.entityId,
					entityType: pair.entityType,
					aliases: pair.aliases,
					foundation: entry.foundation ?? pair.entityName,
					urantia_dev: entry.urantia_dev ?? pair.entityName,
					confidence: entry.confidence ?? "medium",
					source_ref: pair.citationRef,
				};
			} else {
				// Entity not in response — mark for manual review
				result[pair.entityName] = {
					entityId: pair.entityId,
					entityType: pair.entityType,
					aliases: pair.aliases,
					foundation: pair.entityName,
					urantia_dev: pair.entityName,
					confidence: "needs_manual",
					source_ref: pair.citationRef,
				};
			}
		}
		return result;
	} catch (e) {
		console.error("  Failed to parse Claude response:", text.slice(0, 200));
		// Return all as needs_manual
		const result: Glossary = {};
		for (const pair of batch) {
			result[pair.entityName] = {
				entityId: pair.entityId,
				entityType: pair.entityType,
				aliases: pair.aliases,
				foundation: pair.entityName,
				urantia_dev: pair.entityName,
				confidence: "needs_manual",
				source_ref: pair.citationRef,
			};
		}
		return result;
	}
}

async function processNoCitationBatch(
	batch: EntityNoCitation[],
): Promise<Glossary> {
	const entitiesContext = batch
		.map(
			(e, i) =>
				`[${i + 1}] Entity: "${e.entityName}" (type: ${e.entityType}${e.aliases.length > 0 ? `, aliases: ${e.aliases.join(", ")}` : ""})
Description: "${e.description}"`,
		)
		.join("\n\n---\n\n");

	const response = await client.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 4096,
		system: `You are an expert translator specializing in The Urantia Book terminology. You translate entity names from English to Dutch.

For each entity, provide:
1. "foundation": Your best guess at how the Urantia Foundation's official Dutch translation renders this term. Base this on your knowledge of the Dutch Urantia Book translation conventions.
2. "urantia_dev": Your own independent, natural Dutch translation of the entity name.
3. "confidence": "medium" if you're fairly confident, "needs_manual" if uncertain

For proper nouns that typically stay the same in Dutch, use the same name for both.

Respond with ONLY valid JSON — no markdown, no explanation. Format:
{
  "EntityNameInEnglish": {
    "foundation": "Dutch term",
    "urantia_dev": "Your Dutch translation",
    "confidence": "medium|needs_manual"
  }
}`,
		messages: [
			{
				role: "user",
				content: `Translate these ${batch.length} Urantia Book entity names to Dutch:\n\n${entitiesContext}`,
			},
		],
	});

	const text =
		response.content[0]?.type === "text" ? response.content[0].text : "";

	try {
		const parsed = JSON.parse(text);
		const result: Glossary = {};
		for (const entity of batch) {
			const entry = parsed[entity.entityName];
			if (entry) {
				result[entity.entityName] = {
					entityId: entity.entityId,
					entityType: entity.entityType,
					aliases: entity.aliases,
					foundation: entry.foundation ?? entity.entityName,
					urantia_dev: entry.urantia_dev ?? entity.entityName,
					confidence: entry.confidence ?? "medium",
					source_ref: null,
				};
			} else {
				result[entity.entityName] = {
					entityId: entity.entityId,
					entityType: entity.entityType,
					aliases: entity.aliases,
					foundation: entity.entityName,
					urantia_dev: entity.entityName,
					confidence: "needs_manual",
					source_ref: null,
				};
			}
		}
		return result;
	} catch {
		console.error("  Failed to parse Claude response for no-citation batch");
		const result: Glossary = {};
		for (const entity of batch) {
			result[entity.entityName] = {
				entityId: entity.entityId,
				entityType: entity.entityType,
				aliases: entity.aliases,
				foundation: entity.entityName,
				urantia_dev: entity.entityName,
				confidence: "needs_manual",
				source_ref: null,
			};
		}
		return result;
	}
}

function saveGlossary() {
	writeFileSync(OUTPUT_PATH, JSON.stringify(glossary, null, 2));
}

async function main() {
	// Process pairs in batches
	const unprocessedPairs = pairsData.pairs.filter(
		(p) => !(p.entityName in glossary),
	);
	console.log(`\n--- Processing ${unprocessedPairs.length} entity pairs ---`);

	for (let i = 0; i < unprocessedPairs.length; i += BATCH_SIZE) {
		const batch = unprocessedPairs.slice(i, i + BATCH_SIZE);
		const batchNum = Math.floor(i / BATCH_SIZE) + 1;
		const totalBatches = Math.ceil(unprocessedPairs.length / BATCH_SIZE);
		console.log(
			`  Batch ${batchNum}/${totalBatches}: ${batch.map((b) => b.entityName).join(", ")}`,
		);

		const result = await processPairsBatch(batch);
		Object.assign(glossary, result);
		saveGlossary(); // Save after each batch for resumability
	}

	// Process no-citation entities
	const unprocessedNoCitation = pairsData.noCitations.filter(
		(e) => !(e.entityName in glossary),
	);
	if (unprocessedNoCitation.length > 0) {
		console.log(
			`\n--- Processing ${unprocessedNoCitation.length} no-citation entities ---`,
		);
		for (let i = 0; i < unprocessedNoCitation.length; i += BATCH_SIZE) {
			const batch = unprocessedNoCitation.slice(i, i + BATCH_SIZE);
			const batchNum = Math.floor(i / BATCH_SIZE) + 1;
			const totalBatches = Math.ceil(
				unprocessedNoCitation.length / BATCH_SIZE,
			);
			console.log(
				`  Batch ${batchNum}/${totalBatches}: ${batch.map((b) => b.entityName).join(", ")}`,
			);

			const result = await processNoCitationBatch(batch);
			Object.assign(glossary, result);
			saveGlossary();
		}
	}

	// Summary
	const entries = Object.values(glossary);
	const high = entries.filter((e) => e.confidence === "high").length;
	const medium = entries.filter((e) => e.confidence === "medium").length;
	const needsManual = entries.filter(
		(e) => e.confidence === "needs_manual",
	).length;
	const identical = entries.filter(
		(e) => e.foundation === e.urantia_dev,
	).length;
	const different = entries.filter(
		(e) => e.foundation !== e.urantia_dev,
	).length;

	console.log(`\n--- Glossary Complete ---`);
	console.log(`  Total entries:     ${entries.length}`);
	console.log(`  High confidence:   ${high}`);
	console.log(`  Medium confidence: ${medium}`);
	console.log(`  Needs manual:      ${needsManual}`);
	console.log(`  Foundation = urantia.dev: ${identical}`);
	console.log(`  Foundation ≠ urantia.dev: ${different}`);
	console.log(`\nOutput: ${OUTPUT_PATH}`);
}

main().catch((err) => {
	console.error("Glossary build failed:", err);
	process.exit(1);
});
