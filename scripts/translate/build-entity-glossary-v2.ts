import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = join(import.meta.dir, "../..");
const PAIRS_PATH = join(ROOT, "data/translations/nl/entity-pairs-v2.json");
const OUTPUT_PATH = join(ROOT, "data/translations/nl/entity-glossary-v2.json");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
	console.error("ANTHROPIC_API_KEY environment variable is required");
	process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

type ParagraphPair = {
	citationRef: string;
	en: string;
	nl: string;
};

type EntityPairV2 = {
	entityId: string;
	entityName: string;
	entityType: string;
	aliases: string[];
	description: string;
	paragraphs: ParagraphPair[];
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
	entities: EntityPairV2[];
	noCitations: EntityNoCitation[];
};

type GlossaryEntry = {
	entityId: string;
	entityType: string;
	aliases: string[];
	foundation: string;
	urantia_dev: string;
	confidence: "high" | "medium" | "needs_manual";
	source_refs: string[];
	paragraphCount: number;
};

type Glossary = Record<string, GlossaryEntry>;

if (!existsSync(PAIRS_PATH)) {
	console.error(`Entity pairs v2 file not found at ${PAIRS_PATH}`);
	console.error("Run extract-entity-pairs-v2.ts first.");
	process.exit(1);
}

const pairsData: PairsFile = JSON.parse(readFileSync(PAIRS_PATH, "utf-8"));
console.log("=== Build Entity Glossary V2 (Multi-paragraph Context) ===\n");
console.log(
	`Loaded ${pairsData.entities.length} entities + ${pairsData.noCitations.length} no-citation entities`,
);

let glossary: Glossary = {};
if (existsSync(OUTPUT_PATH)) {
	glossary = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
	console.log(
		`Resuming: ${Object.keys(glossary).length} entries already in glossary`,
	);
}

const BATCH_SIZE = 10; // Smaller batches since each entity has more context

async function processBatch(batch: EntityPairV2[]): Promise<Glossary> {
	const entitiesContext = batch
		.map((entity, i) => {
			const paragraphsText = entity.paragraphs
				.map(
					(p, j) =>
						`  Paragraph ${j + 1} (${p.citationRef}):
    English: "${p.en}"
    Dutch (Foundation): "${p.nl}"`,
				)
				.join("\n\n");

			return `[${i + 1}] Entity: "${entity.entityName}" (type: ${entity.entityType}${entity.aliases.length > 0 ? `, aliases: ${entity.aliases.join(", ")}` : ""})
Description: "${entity.description}"
${entity.paragraphs.length} paragraph(s) where this entity appears:

${paragraphsText}`;
		})
		.join("\n\n===\n\n");

	const response = await client.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 4096,
		system: `You are an expert translator specializing in The Urantia Book. You analyze English and Dutch paragraph pairs to identify how specific entity names are translated.

You are given MULTIPLE paragraphs for each entity, showing the entity used in different contexts. Use ALL paragraphs to understand the full meaning and find the most consistent Dutch translation.

For each entity, provide:
1. "foundation": The exact Dutch term used in the Foundation's Dutch translation. Look across ALL provided paragraphs to find the most consistent/frequent rendering. If different paragraphs use different terms, pick the most common one and note alternatives.
2. "urantia_dev": Your own independent, natural Dutch translation. Use the multiple contexts to choose the most accurate and natural term. Consider:
   - How the concept is used across different paragraphs
   - The entity's description for additional semantic context
   - Whether different contexts suggest different nuances
3. "confidence": "high" if the entity clearly appears across multiple paragraphs with consistent translation, "medium" if found but with some ambiguity, "needs_manual" if uncertain

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
				content: `Identify the Dutch translations for each entity below. Each entity has multiple paragraph contexts — use them all for the best translation.\n\n${entitiesContext}`,
			},
		],
	});

	const rawText =
		response.content[0]?.type === "text" ? response.content[0].text : "";
	// Strip markdown code fences if present
	const text = rawText.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

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
					source_refs: entity.paragraphs.map((p) => p.citationRef),
					paragraphCount: entity.paragraphs.length,
				};
			} else {
				result[entity.entityName] = {
					entityId: entity.entityId,
					entityType: entity.entityType,
					aliases: entity.aliases,
					foundation: entity.entityName,
					urantia_dev: entity.entityName,
					confidence: "needs_manual",
					source_refs: entity.paragraphs.map((p) => p.citationRef),
					paragraphCount: entity.paragraphs.length,
				};
			}
		}
		return result;
	} catch {
		console.error("  Failed to parse Claude response:", rawText.slice(0, 200));
		const result: Glossary = {};
		for (const entity of batch) {
			result[entity.entityName] = {
				entityId: entity.entityId,
				entityType: entity.entityType,
				aliases: entity.aliases,
				foundation: entity.entityName,
				urantia_dev: entity.entityName,
				confidence: "needs_manual",
				source_refs: entity.paragraphs.map((p) => p.citationRef),
				paragraphCount: entity.paragraphs.length,
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
1. "foundation": Your best guess at how the Urantia Foundation's official Dutch translation renders this term.
2. "urantia_dev": Your own independent, natural Dutch translation of the entity name.
3. "confidence": "medium" if fairly confident, "needs_manual" if uncertain

Respond with ONLY valid JSON — no markdown, no explanation.
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
					source_refs: [],
					paragraphCount: 0,
				};
			} else {
				result[entity.entityName] = {
					entityId: entity.entityId,
					entityType: entity.entityType,
					aliases: entity.aliases,
					foundation: entity.entityName,
					urantia_dev: entity.entityName,
					confidence: "needs_manual",
					source_refs: [],
					paragraphCount: 0,
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
				source_refs: [],
				paragraphCount: 0,
			};
		}
		return result;
	}
}

function saveGlossary() {
	writeFileSync(OUTPUT_PATH, JSON.stringify(glossary, null, 2));
}

async function main() {
	const unprocessed = pairsData.entities.filter(
		(e) => !(e.entityName in glossary),
	);
	console.log(`\n--- Processing ${unprocessed.length} entities ---`);

	for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
		const batch = unprocessed.slice(i, i + BATCH_SIZE);
		const batchNum = Math.floor(i / BATCH_SIZE) + 1;
		const totalBatches = Math.ceil(unprocessed.length / BATCH_SIZE);
		console.log(
			`  Batch ${batchNum}/${totalBatches}: ${batch.map((b) => `${b.entityName} (${b.paragraphs.length}p)`).join(", ")}`,
		);

		const result = await processBatch(batch);
		Object.assign(glossary, result);
		saveGlossary();
	}

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

	console.log(`\n--- Glossary V2 Complete ---`);
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
