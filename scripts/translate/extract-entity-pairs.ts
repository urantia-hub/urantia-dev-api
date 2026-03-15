import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const URANTIAPEDIA = join(ROOT, "../urantiapedia/input/json");
const SEED_PATH = join(ROOT, "data/entities/seed-entities.json");
const OUTPUT_PATH = join(ROOT, "data/translations/nl/entity-pairs.json");

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

// Parse a citation ref like "93:1.1" or "76:2" into { paper, section, paragraph? }
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

// Find a paragraph in a Urantiapedia paper JSON by par_ref
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

// Find the first paragraph of a section
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

// Cache loaded papers to avoid re-reading files
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

// Parse --limit flag
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

console.log("=== Extract EN/NL Entity Paragraph Pairs ===\n");

const allEntities: SeedEntity[] = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
const entities = limit ? allEntities.slice(0, limit) : allEntities;
console.log(
	`Processing ${entities.length} entities${limit ? ` (limited from ${allEntities.length})` : ""}`,
);

const pairs: EntityPair[] = [];
const noCitations: EntityNoCitation[] = [];
let skipped = 0;

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

	const firstCitation = entity.citations[0]!;
	const parsed = parseCitation(firstCitation);
	if (!parsed) {
		console.warn(`  Skipping "${entity.name}": unrecognized citation "${firstCitation}"`);
		skipped++;
		continue;
	}

	const enPaper = loadPaper("en", parsed.paper);
	const nlPaper = loadPaper("nl", parsed.paper);

	if (!enPaper || !nlPaper) {
		console.warn(`  Skipping "${entity.name}": could not load paper ${parsed.paper}`);
		skipped++;
		continue;
	}

	let enText: string | null = null;
	let nlText: string | null = null;
	let usedRef = firstCitation;

	if (parsed.paragraph !== undefined) {
		// Exact ref like "93:1.1"
		enText = findParagraph(enPaper, firstCitation);
		nlText = findParagraph(nlPaper, firstCitation);
	} else {
		// Section-only ref like "76:2" → use first paragraph of that section
		const enFirst = findFirstParagraphInSection(enPaper, parsed.section);
		const nlFirst = findFirstParagraphInSection(nlPaper, parsed.section);
		if (enFirst && nlFirst) {
			enText = enFirst.content;
			nlText = nlFirst.content;
			usedRef = enFirst.ref;
		}
	}

	if (!enText || !nlText) {
		console.warn(
			`  Skipping "${entity.name}": paragraph "${firstCitation}" not found in EN or NL`,
		);
		skipped++;
		continue;
	}

	pairs.push({
		entityId: entity.id,
		entityName: entity.name,
		entityType: entity.type,
		aliases: entity.aliases,
		citationRef: usedRef,
		en: enText,
		nl: nlText,
	});
}

const output = {
	metadata: {
		generatedAt: new Date().toISOString(),
		totalEntities: entities.length,
		pairsExtracted: pairs.length,
		noCitations: noCitations.length,
		skipped,
	},
	pairs,
	noCitations,
};

writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log(`\n--- Results ---`);
console.log(`  Pairs extracted: ${pairs.length}`);
console.log(`  No citations:    ${noCitations.length}`);
console.log(`  Skipped:         ${skipped}`);
console.log(`\nOutput: ${OUTPUT_PATH}`);
