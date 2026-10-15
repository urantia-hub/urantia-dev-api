/**
 * Parse Urantiapedia topic index TXT files into a structured entity catalog.
 * Reads all .txt files from urantiapedia/input/txt/topic-index-en/
 * Outputs data/entities/seed-entities.json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EntityType, SeedEntity } from "./config.ts";
import { CATEGORY_MAP, extractCitations, slugify, TOPIC_INDEX_DIR } from "./config.ts";

const topicDir = join(import.meta.dir, TOPIC_INDEX_DIR);
const outputDir = join(import.meta.dir, "../../data/entities");
const outputPath = join(outputDir, "seed-entities.json");

if (!existsSync(topicDir)) {
	console.error(`Topic index directory not found: ${topicDir}`);
	process.exit(1);
}

if (!existsSync(outputDir)) {
	mkdirSync(outputDir, { recursive: true });
}

const files = readdirSync(topicDir)
	.filter((f) => f.endsWith(".txt"))
	.sort();
console.log(`Found ${files.length} topic index files`);

const entities: SeedEntity[] = [];
const idSet = new Set<string>();
const duplicates: string[] = [];

for (const file of files) {
	const content = readFileSync(join(topicDir, file), "utf-8");
	const lines = content.split("\n");

	// Skip header block (lines starting with <)
	let i = 0;
	while (i < lines.length && (lines[i].startsWith("<") || lines[i].trim() === "")) {
		i++;
	}

	// Parse entries separated by blank lines
	let entryLines: string[] = [];

	for (; i <= lines.length; i++) {
		const line = i < lines.length ? lines[i] : undefined;

		if (line === undefined || line.trim() === "") {
			if (entryLines.length > 0) {
				const entity = parseEntry(entryLines);
				if (entity) {
					if (idSet.has(entity.id)) {
						duplicates.push(`${entity.id} (${entity.name}) in ${file}`);
					} else {
						idSet.add(entity.id);
						entities.push(entity);
					}
				}
				entryLines = [];
			}
		} else {
			entryLines.push(line);
		}
	}
}

function parseEntry(lines: string[]): SeedEntity | null {
	const header = lines[0];
	const parts = header.split("|").map((p) => p.trim());

	if (parts.length < 2) return null;

	// Field 0: Name; Alias1; Alias2
	const nameField = parts[0];
	const names = nameField
		.split(";")
		.map((n) => n.trim())
		.filter(Boolean);
	if (names.length === 0) return null;

	const name = names[0];
	const aliases = names.slice(1);

	// Field 1: References (in header)
	// Field 2: See Also
	// Field 3: Category
	// Field 4: Status (OK)
	const seeAlsoField = parts[2] || "";
	const categoryField = parts[3] || "";

	const seeAlso = seeAlsoField
		.split(";")
		.map((s) => s.trim())
		.filter(Boolean);

	const category = categoryField.trim().toUpperCase();
	const type: EntityType = CATEGORY_MAP[category] || "concept";

	// Extract citations from the entire entry (header + all description lines)
	const fullText = lines.join("\n");
	const citations = extractCitations(fullText);

	// Build description from non-tab-indented lines after the header
	// Skip external links (lines starting with >)
	const descLines: string[] = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith(">")) continue;
		if (!line.startsWith("\t")) {
			descLines.push(line.trim());
		}
	}
	const description = descLines.join(" ").trim();

	const id = slugify(name);
	if (!id) return null;

	return {
		id,
		name,
		type,
		aliases,
		description,
		seeAlso,
		citations,
	};
}

// Write output
writeFileSync(outputPath, JSON.stringify(entities, null, 2));

// Stats
const typeCounts: Record<string, number> = {};
for (const e of entities) {
	typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
}

console.log(`\nParsed ${entities.length} entities from ${files.length} files`);
console.log("\nType distribution:");
for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
	console.log(`  ${type}: ${count}`);
}

const noCitations = entities.filter((e) => e.citations.length === 0).length;
console.log(`\nEntities with no citations: ${noCitations}`);

if (duplicates.length > 0) {
	console.log(`\nDuplicate IDs skipped (${duplicates.length}):`);
	for (const d of duplicates.slice(0, 10)) {
		console.log(`  ${d}`);
	}
	if (duplicates.length > 10) {
		console.log(`  ... and ${duplicates.length - 10} more`);
	}
}

console.log(`\nOutput: ${outputPath}`);
