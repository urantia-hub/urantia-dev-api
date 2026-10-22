/**
 * prepare-glossary.ts — Write packets to translate the glossary terms from the English only.
 *
 * Usage:
 *   bun scripts/translate/agent/prepare-glossary.ts --lang=es --limit=1   # the most-used terms first
 *   bun scripts/translate/agent/prepare-glossary.ts --lang=es             # every term not yet done
 *
 * Terms are sorted by how many paragraphs mention them. Each packet includes the terms
 * already in glossary.json, so later batches follow the earlier choices.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	glossaryEntities,
	glossaryPath,
	LANG_NAMES,
	loadGlossary,
	parseArgs,
	STYLE_GUIDE_DIR,
	WORK_DIR,
} from "./lib.ts";

// Each term needs a look-up in the papers, so batches are smaller than for plain translation.
const BATCH_SIZE = 75;

const { lang, flags } = parseArgs();
const limitArg = [...flags].find((a) => a.startsWith("--limit="))?.split("=")[1];
const language = LANG_NAMES[lang]!;
const dir = join(WORK_DIR, lang, "glossary");

const glossary = loadGlossary(lang);
const todo = glossaryEntities()
	.filter((e) => !glossary[e.id])
	.sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
const batches = Array.from({ length: Math.ceil(todo.length / BATCH_SIZE) }, (_, i) =>
	todo.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
).slice(0, limitArg ? Number(limitArg) : undefined);

// Old packets list terms that may be done now.
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir).filter((f) => f.endsWith(".packet.md"))) rmSync(join(dir, f));

const cleanRoom = readFileSync(join(import.meta.dir, "clean-room.md"), "utf-8");
const method = readFileSync(join(import.meta.dir, "meaning-first.md"), "utf-8");
const guidePath = join(STYLE_GUIDE_DIR, `${lang}.md`);
const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf-8") : "";
const done = Object.entries(glossary);
const doneById = new Map(glossaryEntities().map((e) => [e.id, e.name]));

batches.forEach((batch, i) => {
	const stamp = `${Date.now().toString(36)}-${String(i).padStart(2, "0")}`;
	const draft = join(dir, `batch-${stamp}.draft.json`);
	const packet = `# Translate glossary terms into ${language}

These are coined names and terms from the Urantia Papers: beings, places, orders, races, religions, and capitalized concepts. Translators of the papers must use your forms, so choose each one with care. Your work will be released as CC0.

${cleanRoom}

${method}

## Rules for the forms

1. Keep the English capitals: a capitalized English term stays capitalized.
2. Historical people and places (Jesus, Jerusalem, Athens): use the standard ${language} form. You do not need a look-up for these; give the meaning in a few words.
3. Names that exist only in this book (Nebadon, Havona, Salvington, Caligastia): keep the English spelling. Still find and state what the name refers to.
4. One English word has one translation in all terms. If "Adjuster" is "X" in one term, it is "X" in every term that contains it. The terms already done are listed below. Follow them. If you find that an earlier choice is wrong, keep it in your output and explain the problem in \`rejected\` of the term that shows it.
5. \`aliases\`: the shorter forms of your name that a translator can use in a sentence, when the English aliases show such forms. Leave it out when there are none.

${guide}

## Output

Write one JSON file to \`${draft}\`. It has one key for each term id below (${batch.length} in total). \`meaning\` and \`confidence\` are required. \`meaning\` is in English.

\`\`\`json
{
  "${batch[0]!.id}": {
    "name": "…",
    "aliases": ["…"],
    "meaning": "One English sentence, with references (77:0.1).",
    "confidence": "high",
    "rejected": [{ "form": "…", "reason": "…" }]
  }
}
\`\`\`

## Terms already done (${done.length})

${done.length ? done.map(([id, g]) => `- ${doneById.get(id) ?? id}: ${g.name}`).join("\n") : "(none yet)"}

## Terms to translate

${batch
	.map(
		(e) =>
			`### ${e.id}\n\n- English: ${e.name}\n- Type: ${e.type}${e.aliases.length ? `\n- English aliases: ${e.aliases.join("; ")}` : ""}\n- Description: ${e.description}`,
	)
	.join("\n\n")}
`;
	writeFileSync(join(dir, `batch-${stamp}.packet.md`), packet);
	console.log(`Batch ${i + 1}: ${batch.length} terms → ${join(dir, `batch-${stamp}.packet.md`)}`);
});

console.log(
	`${Object.keys(glossary).length} done, ${todo.length} to do. Output: ${glossaryPath(lang)}`,
);
