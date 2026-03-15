import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = join(import.meta.dir, "../..");
const URANTIAPEDIA = join(ROOT, "../urantiapedia/input/json");
const SEED_PATH = join(ROOT, "data/entities/seed-entities.json");
const EVAL_PATH = join(ROOT, "data/entities/entity-evaluation.json");
const SEED_V2_PATH = join(ROOT, "data/entities/seed-entities-v2.json");
const REVIEW_PATH = join(ROOT, "data/entities/entity-evaluation-review.md");

const MAX_PARAGRAPHS = 100; // Use all available paragraphs, sampled evenly when over limit
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

type UrantiapediaParagraph = {
	par_ref: string;
	par_content: string;
};

type UrantiapediaSection = {
	section_index: number;
	pars: UrantiapediaParagraph[];
};

type UrantiapediaPaper = {
	paper_index: number;
	sections: UrantiapediaSection[];
};

type EntityEval = {
	id: string;
	name: string;
	type: string;
	status: "keep" | "skip" | "merge";
	reason: string;
	originalDescription: string;
	improvedDescription: string;
	descriptionChanged: boolean;
};

// --- Paragraph loading (reused from extract-entity-pairs-v2.ts) ---

const paperCache = new Map<string, UrantiapediaPaper>();

function loadPaper(lang: string, paperIndex: number): UrantiapediaPaper | null {
	const key = `${lang}:${paperIndex}`;
	if (paperCache.has(key)) return paperCache.get(key)!;
	const padded = String(paperIndex).padStart(3, "0");
	const filePath = join(URANTIAPEDIA, `book-${lang}`, `Doc${padded}.json`);
	try {
		const data = JSON.parse(readFileSync(filePath, "utf-8"));
		paperCache.set(key, data);
		return data;
	} catch {
		return null;
	}
}

function findParagraph(paper: UrantiapediaPaper, ref: string): string | null {
	for (const section of paper.sections) {
		for (const par of section.pars) {
			if (par.par_ref === ref) return par.par_content;
		}
	}
	return null;
}

function findFirstInSection(paper: UrantiapediaPaper, sectionIndex: number): string | null {
	for (const section of paper.sections) {
		if (section.section_index === sectionIndex && section.pars.length > 0) {
			return section.pars[0]!.par_content;
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

// Sample citations evenly across the list when there are more than MAX_PARAGRAPHS.
// This ensures we get paragraphs from early, middle, and late papers rather than
// only the first N citations.
function sampleEvenly<T>(items: T[], max: number): T[] {
	if (items.length <= max) return items;
	const result: T[] = [];
	const step = items.length / max;
	for (let i = 0; i < max; i++) {
		result.push(items[Math.floor(i * step)]!);
	}
	return result;
}

function getEntityParagraphs(entity: SeedEntity): string[] {
	const sampled = sampleEvenly(entity.citations, MAX_PARAGRAPHS);
	const paragraphs: string[] = [];
	for (const citation of sampled) {
		const parsed = parseCitation(citation);
		if (!parsed) continue;
		const paper = loadPaper("en", parsed.paper);
		if (!paper) continue;
		let text: string | null = null;
		if ("paragraph" in parsed) {
			text = findParagraph(paper, citation);
		} else {
			text = findFirstInSection(paper, parsed.section);
		}
		if (text) paragraphs.push(text);
	}
	return paragraphs;
}

// --- Claude evaluation ---

async function evaluateBatch(batch: SeedEntity[]): Promise<EntityEval[]> {
	const context = batch.map((entity, i) => {
		const paragraphs = getEntityParagraphs(entity);
		const paraText = paragraphs.length > 0
			? paragraphs.map((p, j) => `  Paragraph ${j + 1}: "${p}"`).join("\n")
			: "  (no paragraphs available)";

		return `[${i + 1}] Entity: "${entity.name}" (id: ${entity.id}, type: ${entity.type})
Aliases: ${entity.aliases.length > 0 ? entity.aliases.join(", ") : "(none)"}
SeeAlso: ${entity.seeAlso.length > 0 ? entity.seeAlso.join(", ") : "(none)"}
Citations: ${entity.citations.length}
Current description: "${entity.description || "(empty)"}"

Context paragraphs from The Urantia Book:
${paraText}`;
	}).join("\n\n===\n\n");

	const response = await callWithRetry(() => client.messages.create({
		model: "claude-sonnet-4-20250514",
		max_tokens: 16384,
		system: `You are improving entity descriptions from The Urantia Book. Every entity is kept — your job is to write the best possible description.

For each entity, write an improved English description:
- Remove inline citation references like "(77:9.4-5)" — these don't belong in prose descriptions
- Fix grammar and spelling errors
- Complete any truncated sentences
- Make the description clear, concise, and informative
- Use the provided paragraph context to write a better, more comprehensive description
- Keep descriptions factual and 1-3 sentences long
- If the current description is empty, write a new one based on the paragraph context and entity metadata
- If the current description is already good, you may keep it as-is or lightly improve it

Respond with ONLY valid JSON array — no markdown, no explanation:
[
  {
    "id": "entity-id",
    "improvedDescription": "Cleaned up description text"
  }
]`,
		messages: [{
			role: "user",
			content: `Evaluate these ${batch.length} entities:\n\n${context}`,
		}],
	}));

	const rawText = response.content[0]?.type === "text" ? response.content[0].text : "";
	const text = rawText.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

	try {
		let parsed: Array<{ id: string; improvedDescription: string }>;
		try {
			parsed = JSON.parse(text);
		} catch {
			const objects: Array<{ id: string; improvedDescription: string }> = [];
			const objectMatches = text.matchAll(/\{[^{}]*"id"\s*:\s*"([^"]+)"[^{}]*\}/g);
			for (const match of objectMatches) {
				try {
					objects.push(JSON.parse(match[0]));
				} catch {
					// Skip malformed individual objects
				}
			}
			if (objects.length === 0) throw new Error("No valid objects found");
			parsed = objects;
		}
		return batch.map((entity) => {
			const eval_ = parsed.find((e) => e.id === entity.id);
			const improved = eval_?.improvedDescription || entity.description || "";
			return {
				id: entity.id,
				name: entity.name,
				type: entity.type,
				status: "keep" as const,
				reason: "All entities kept",
				originalDescription: entity.description || "",
				improvedDescription: improved,
				descriptionChanged: improved !== (entity.description || ""),
			};
		});
	} catch (err) {
		console.error("  Parse error:", (err as Error).message);
		console.error("  Response length:", rawText.length, "| stop_reason:", response.stop_reason);
		console.error("  Last 200 chars:", rawText.slice(-200));
		return batch.map((entity) => ({
			id: entity.id,
			name: entity.name,
			type: entity.type,
			status: "keep" as const,
			reason: "Parse error (fallback)",
			originalDescription: entity.description || "",
			improvedDescription: entity.description || "",
			descriptionChanged: false,
		}));
	}
}

// --- Main ---

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

const allEntities: SeedEntity[] = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
const entities = limit ? allEntities.slice(0, limit) : allEntities;

console.log("=== Entity Quality Evaluation ===\n");
console.log(`Processing ${entities.length} entities${limit ? ` (limited from ${allEntities.length})` : ""}\n`);

// Load existing evaluation for resumability
let evaluations: EntityEval[] = [];
const processedIds = new Set<string>();
if (existsSync(EVAL_PATH)) {
	evaluations = JSON.parse(readFileSync(EVAL_PATH, "utf-8"));
	for (const e of evaluations) processedIds.add(e.id);
	console.log(`Resuming: ${evaluations.length} entities already evaluated\n`);
}

const unprocessed = entities.filter((e) => !processedIds.has(e.id));

async function main() {
	for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
		const batch = unprocessed.slice(i, i + BATCH_SIZE);
		const batchNum = Math.floor(i / BATCH_SIZE) + 1;
		const totalBatches = Math.ceil(unprocessed.length / BATCH_SIZE);
		console.log(`Batch ${batchNum}/${totalBatches}: ${batch.map((b) => b.name).join(", ")}`);

		const results = await evaluateBatch(batch);
		evaluations.push(...results);

		// Save after each batch
		writeFileSync(EVAL_PATH, JSON.stringify(evaluations, null, 2));
	}

	// --- Generate seed-entities-v2.json ---
	const evalMap = new Map(evaluations.map((e) => [e.id, e]));
	const seedV2 = allEntities.map((entity) => {
		const eval_ = evalMap.get(entity.id);
		if (eval_ && eval_.descriptionChanged) {
			return { ...entity, description: eval_.improvedDescription };
		}
		return entity;
	});
	writeFileSync(SEED_V2_PATH, JSON.stringify(seedV2, null, 2));

	// --- Generate review markdown ---
	const changed = evaluations.filter((e) => e.descriptionChanged);
	const unchanged = evaluations.filter((e) => !e.descriptionChanged);
	const fallbacks = evaluations.filter((e) => e.reason.includes("fallback"));

	const lines: string[] = [];
	lines.push("# Entity Description Improvements");
	lines.push("");
	lines.push(`${evaluations.length} entities evaluated | ${changed.length} descriptions improved | ${unchanged.length} unchanged | ${fallbacks.length} fallbacks`);
	lines.push("");

	if (changed.length > 0) {
		lines.push("---");
		lines.push("");
		lines.push("## Improved Descriptions");
		lines.push("");
		for (const e of changed.sort((a, b) => a.name.localeCompare(b.name))) {
			lines.push(`**${e.name}** (${e.type})`);
			lines.push(`- Before: ${e.originalDescription}`);
			lines.push(`- After: ${e.improvedDescription}`);
			lines.push("");
		}
	}

	writeFileSync(REVIEW_PATH, lines.join("\n"));

	// --- Summary ---
	console.log(`\n--- Evaluation Complete ---`);
	console.log(`  Total:                ${evaluations.length}`);
	console.log(`  Descriptions improved: ${changed.length}`);
	console.log(`  Unchanged:            ${unchanged.length}`);
	console.log(`  Fallbacks:            ${fallbacks.length}`);
	console.log(`\nOutput:`);
	console.log(`  ${EVAL_PATH}`);
	console.log(`  ${SEED_V2_PATH}`);
	console.log(`  ${REVIEW_PATH}`);
}

main().catch((err) => {
	console.error("Evaluation failed:", err);
	process.exit(1);
});
