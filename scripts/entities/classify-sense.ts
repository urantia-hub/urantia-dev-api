// Classifies each lowercase concept as a term of the papers ("special") or a word in its ordinary sense ("ordinary").
// Usage: bun scripts/entities/classify-sense.ts            write agent packets to .work/entities/sense/
//        bun scripts/entities/classify-sense.ts --apply    merge the agents' drafts into seed-entities.json and write the SQL
// The Hub shows a term when its word stands in a paragraph, so an ordinary word there is noise.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SeedEntity = {
	id: string;
	name: string;
	type: string;
	aliases: string[];
	description: string;
	seeAlso: string[];
	citations: string[];
	sense?: Sense;
};
type Sense = "special" | "ordinary";

const BATCH_SIZE = 100;
const SENSES = new Set<string>(["special", "ordinary"]);
const seedPath = join(import.meta.dir, "../../data/entities/seed-entities.json");
const workDir = join(import.meta.dir, "../../.work/entities/sense");
const sqlPath = join(import.meta.dir, "../../data/entities/fixes/2026-10-22-sense.sql");
const seed: SeedEntity[] = JSON.parse(readFileSync(seedPath, "utf-8"));
const todo = seed.filter((e) => e.type === "concept" && /^[a-z]/.test(e.name));

if (process.argv.includes("--apply")) {
	const byId = new Map(todo.map((e) => [e.id, e]));
	const ruled = new Map<string, Sense>();
	for (const file of readdirSync(workDir)
		.filter((f) => f.endsWith(".draft.json"))
		.sort()) {
		const draft: Record<string, { sense: string; reason: string }> = JSON.parse(
			readFileSync(join(workDir, file), "utf-8"),
		);
		for (const [id, v] of Object.entries(draft)) {
			if (!byId.has(id)) throw new Error(`${file}: ${id} is not a lowercase concept`);
			if (!SENSES.has(v.sense)) throw new Error(`${file}: ${id} has the sense ${v.sense}`);
			ruled.set(id, v.sense as Sense);
		}
	}
	const missing = todo.filter((e) => !ruled.has(e.id));
	if (missing.length)
		throw new Error(`${missing.length} concepts have no ruling, first: ${missing[0]!.id}`);
	for (const e of seed) if (ruled.has(e.id)) e.sense = ruled.get(e.id);
	writeFileSync(seedPath, JSON.stringify(seed, null, 2));
	// The seed adds the column's values on a new database; this SQL sets them on a live one.
	const rows = [...ruled].map(([id, sense]) => `('${id.replaceAll("'", "''")}', '${sense}')`);
	writeFileSync(
		sqlPath,
		`BEGIN;\nALTER TABLE entities ADD COLUMN IF NOT EXISTS sense text;\nUPDATE entities AS e SET sense = v.sense FROM (VALUES\n${rows.join(",\n")}\n) AS v(id, sense) WHERE e.id = v.id;\nCOMMIT;\n`,
	);
	const ordinary = [...ruled.values()].filter((s) => s === "ordinary").length;
	console.log(`${ruled.size} concepts: ${ordinary} ordinary, ${ruled.size - ordinary} special`);
	process.exit(0);
}

const method = `# Classify concepts: a term of the papers, or an ordinary word

UrantiaHub shows "Terms in this paragraph" beside each paragraph of the Urantia Papers. A term shows when its name stands in the paragraph. Many entries below are plain English words ("claws", "gravel", "education"). When the papers use such a word in its everyday sense, the panel fills with noise. A wrong term is worse than no term.

For each entry, choose one sense:

- **special**: a reader who meets the word in the papers learns something from the entry that a dictionary does not give. That is: a word the papers coin ("oudah", "superbreathers", "insideness"), a common word that the papers define or use in their own sense ("light and life", "consecration of choice", "adjutant"), or a fixed phrase that names one thing in the papers.
- **ordinary**: the papers use the word in its everyday sense. This holds even when the papers discuss the topic at length ("education", "animals", "temptation", "gold").

## Method

1. Read the name, the other names, the description, and the citation count.
2. When the sense is not clear, check the papers with the urantia.dev MCP server: \`search_fulltext\` for the word (use \`type=phrase\` for a phrase), then read two or three uses with \`paragraphs_get\`. The description is a summary, not the source. The papers are the source.
3. When a word has both an ordinary use and a special use, choose by how the papers use it most of the time. A special sense that occurs in one place only is "ordinary", unless the entry names that one thing.
4. Write one short reason (15 words or fewer), with a reference when you checked the papers.

## Rules

- Do not search the web.
- Do not open other files, except to write your output file.
`;

mkdirSync(workDir, { recursive: true });
for (const f of readdirSync(workDir).filter((f) => f.endsWith(".packet.md")))
	rmSync(join(workDir, f));
for (let i = 0; i < todo.length; i += BATCH_SIZE) {
	const batch = todo.slice(i, i + BATCH_SIZE);
	const n = String(i / BATCH_SIZE).padStart(2, "0");
	const draft = join(workDir, `sense-${n}.draft.json`);
	if (existsSync(draft)) continue;
	const entries = batch
		.map((e) => {
			const description =
				e.description.length > 240 ? `${e.description.slice(0, 240)}…` : e.description;
			const aliases = e.aliases.length ? ` (also: ${e.aliases.join("; ")})` : "";
			return `### ${e.id}\n\n- Name: ${e.name}${aliases}\n- Cited in ${e.citations.length} paragraphs: ${e.citations.slice(0, 5).join(", ")}\n- Description: ${description}`;
		})
		.join("\n\n");
	writeFileSync(
		join(workDir, `sense-${n}.packet.md`),
		`${method}\n## Output\n\nWrite one JSON file to \`${draft}\`: \`{ "<id>": { "sense": "special" | "ordinary", "reason": "…" } }\`. Include every entry below (${batch.length}).\n\n## Entries\n\n${entries}\n`,
	);
}
console.log(
	`${todo.length} lowercase concepts in ${Math.ceil(todo.length / BATCH_SIZE)} packets → ${workDir}`,
);
