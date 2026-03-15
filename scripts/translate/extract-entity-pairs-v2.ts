import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const URANTIAPEDIA = join(ROOT, "../urantiapedia/input/json");
const SEED_PATH = join(ROOT, "data/entities/seed-entities.json");
const OUTPUT_PATH = join(ROOT, "data/translations/nl/entity-pairs-v2.json");

const MAX_PARAGRAPHS_PER_ENTITY = 5;

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
	par_pageref: string;
	par_content: string;
};

type UrantiapediaSection = {
	section_index: number;
	section_ref: string;
	section_title?: string;
	pars: UrantiapediaParagraph[];
};

type UrantiapediaPaper = {
	paper_index: number;
	sections: UrantiapediaSection[];
};

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

function parseCitation(ref: string): {
	paper: number;
	section: number;
	paragraph?: number;
} | null {
	const exactMatch = ref.match(/^(\d+):(\d+)\.(\d+)$/);
	if (exactMatch) {
		return {
			paper: Number(exactMatch[1]),
			section: Number(exactMatch[2]),
			paragraph: Number(exactMatch[3]),
		};
	}
	const sectionMatch = ref.match(/^(\d+):(\d+)$/);
	if (sectionMatch) {
		return {
			paper: Number(sectionMatch[1]),
			section: Number(sectionMatch[2]),
		};
	}
	return null;
}

function findParagraph(
	paper: UrantiapediaPaper,
	targetRef: string,
): string | null {
	for (const section of paper.sections) {
		for (const par of section.pars) {
			if (par.par_ref === targetRef) {
				return par.par_content;
			}
		}
	}
	return null;
}

function findFirstParagraphInSection(
	paper: UrantiapediaPaper,
	sectionIndex: number,
): { ref: string; content: string } | null {
	for (const section of paper.sections) {
		if (section.section_index === sectionIndex && section.pars.length > 0) {
			const par = section.pars[0]!;
			return { ref: par.par_ref, content: par.par_content };
		}
	}
	return null;
}

const paperCache = new Map<string, UrantiapediaPaper>();

function loadPaper(lang: string, paperIndex: number): UrantiapediaPaper | null {
	const key = `${lang}:${paperIndex}`;
	if (paperCache.has(key)) {
		return paperCache.get(key)!;
	}
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

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

console.log("=== Extract EN/NL Entity Paragraph Pairs (V2 — Multi-paragraph) ===\n");

const allEntities: SeedEntity[] = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
const entities = limit ? allEntities.slice(0, limit) : allEntities;
console.log(
	`Processing ${entities.length} entities${limit ? ` (limited from ${allEntities.length})` : ""}`,
);
console.log(`Up to ${MAX_PARAGRAPHS_PER_ENTITY} paragraphs per entity\n`);

const results: EntityPairV2[] = [];
const noCitations: EntityNoCitation[] = [];
let skipped = 0;
let totalParagraphs = 0;

for (const entity of entities) {
	if (entity.citations.length === 0) {
		noCitations.push({
			entityId: entity.id,
			entityName: entity.name,
			entityType: entity.type,
			aliases: entity.aliases,
			description: entity.description,
		});
		continue;
	}

	const paragraphs: ParagraphPair[] = [];
	const citationsToProcess = entity.citations.slice(0, MAX_PARAGRAPHS_PER_ENTITY);

	for (const citation of citationsToProcess) {
		const parsed = parseCitation(citation);
		if (!parsed) continue;

		const enPaper = loadPaper("en", parsed.paper);
		const nlPaper = loadPaper("nl", parsed.paper);
		if (!enPaper || !nlPaper) continue;

		let enText: string | null = null;
		let nlText: string | null = null;
		let usedRef = citation;

		if (parsed.paragraph !== undefined) {
			enText = findParagraph(enPaper, citation);
			nlText = findParagraph(nlPaper, citation);
		} else {
			const enFirst = findFirstParagraphInSection(enPaper, parsed.section);
			const nlFirst = findFirstParagraphInSection(nlPaper, parsed.section);
			if (enFirst && nlFirst) {
				enText = enFirst.content;
				nlText = nlFirst.content;
				usedRef = enFirst.ref;
			}
		}

		if (enText && nlText) {
			paragraphs.push({ citationRef: usedRef, en: enText, nl: nlText });
		}
	}

	if (paragraphs.length === 0) {
		console.warn(`  Skipping "${entity.name}": no paragraphs resolved`);
		skipped++;
		continue;
	}

	totalParagraphs += paragraphs.length;
	results.push({
		entityId: entity.id,
		entityName: entity.name,
		entityType: entity.type,
		aliases: entity.aliases,
		description: entity.description,
		paragraphs,
	});
}

const avgParagraphs = results.length > 0 ? (totalParagraphs / results.length).toFixed(1) : "0";

const output = {
	metadata: {
		generatedAt: new Date().toISOString(),
		totalEntities: entities.length,
		entitiesWithParagraphs: results.length,
		noCitations: noCitations.length,
		skipped,
		totalParagraphs,
		avgParagraphsPerEntity: Number(avgParagraphs),
		maxParagraphsPerEntity: MAX_PARAGRAPHS_PER_ENTITY,
	},
	entities: results,
	noCitations,
};

writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log(`--- Results ---`);
console.log(`  Entities with paragraphs: ${results.length}`);
console.log(`  No citations:             ${noCitations.length}`);
console.log(`  Skipped:                  ${skipped}`);
console.log(`  Total paragraphs:         ${totalParagraphs}`);
console.log(`  Avg paragraphs/entity:    ${avgParagraphs}`);
console.log(`\nOutput: ${OUTPUT_PATH}`);
