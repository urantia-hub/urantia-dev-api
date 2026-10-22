/**
 * prepare-glossary.ts — Write packets to translate the glossary terms from the English only.
 *
 * Usage:
 *   bun scripts/translate/agent/prepare-glossary.ts --lang=es --limit=1   # the most-used family batch first
 *   bun scripts/translate/agent/prepare-glossary.ts --lang=es             # every term not yet done
 *   bun scripts/translate/agent/prepare-glossary.ts --lang=es --second    # second opinions on hard terms
 *
 * A word family (morontia, morontial, mota) always goes in one batch, so its root is chosen once.
 * Each packet lists the terms already in glossary.json, so later batches follow earlier choices.
 * A second-opinion packet holds the same input but never shows the first translator's choice
 * for its own terms.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type GlossaryEntity,
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
const SECOND = flags.has("--second");
const language = LANG_NAMES[lang]!;
const dir = join(WORK_DIR, lang, "glossary");
const prefix = SECOND ? "second" : "batch";

const glossary = loadGlossary(lang);
const entities = glossaryEntities();

const todo = entities.filter((e) => {
	const g = glossary[e.id];
	if (!SECOND) return !g;
	// Second opinions: every key concept, and every term the first translator was unsure of.
	return (
		g &&
		!g.decision &&
		!g.second &&
		(e.key || g.confidence !== "high" || g.formConfidence !== "high")
	);
});

// Group by family, then pack whole families into batches, most-used first.
const groups = new Map<string, GlossaryEntity[]>();
for (const e of todo) {
	const k = e.family ? `family:${e.family}` : `term:${e.id}`;
	groups.set(k, [...(groups.get(k) ?? []), e]);
}
const ordered = [...groups.values()]
	.map((g) => g.sort((a, b) => b.mentions - a.mentions))
	.sort((a, b) => b[0]!.mentions - a[0]!.mentions);
const batches: GlossaryEntity[][] = [];
let current: GlossaryEntity[] = [];
for (const group of ordered) {
	if (current.length && current.length + group.length > BATCH_SIZE) {
		batches.push(current);
		current = [];
	}
	current.push(...group);
}
if (current.length) batches.push(current);
const selected = batches.slice(0, limitArg ? Number(limitArg) : undefined);

// Old packets list terms that may be done now.
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".packet.md"))) {
	rmSync(join(dir, f));
}

const cleanRoom = readFileSync(join(import.meta.dir, "clean-room.md"), "utf-8");
const method = readFileSync(join(import.meta.dir, "meaning-first.md"), "utf-8");
const guidePath = join(STYLE_GUIDE_DIR, `${lang}.md`);
const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf-8") : "";
const nameById = new Map(entities.map((e) => [e.id, e.name]));

selected.forEach((batch, i) => {
	const stamp = `${Date.now().toString(36)}-${String(i).padStart(2, "0")}`;
	const draft = join(dir, `${prefix}-${stamp}.draft.json`);
	const own = new Set(batch.map((e) => e.id));
	const done = Object.entries(glossary).filter(([id]) => !own.has(id));
	const families = [...new Set(batch.map((e) => e.family).filter(Boolean))];

	const packet = `# Translate glossary terms into ${language}

These are coined names and key terms from the Urantia Papers. Translators of the papers must use your forms, so choose each one with care. Your work will be released as CC0.
${SECOND ? "\nAnother translator already chose forms for these terms. You do not see those choices, so that your work is independent. Do the full method yourself.\n" : ""}
${cleanRoom}

${method}

## Rules for the forms

1. Keep the English capitals: a capitalized English term stays capitalized.
2. Historical people and places (Jesus, Jerusalem, Athens): use the standard ${language} form. You do not need a look-up for these; give the meaning in a few words.
3. Names that exist only in this book (Nebadon, Havona, Salvington, Caligastia): keep the English spelling. Still find and state what the name refers to.
4. One English word has one translation in all terms. If "Adjuster" is "X" in one term, it is "X" in every term that contains it. The terms already done are listed below. Follow them. If you find that an earlier choice is wrong, keep it in your output and explain the problem in \`rejected\` of the term that shows it.
5. Word families${families.length ? ` in this batch (${families.join(", ")})` : ""}: choose the root once and derive the other forms from it, so the family stays visible in ${language}.
6. Key concepts are common English words that the papers use in a special sense (personality, mind, soul, morontia). For these, find the special sense, then choose the ${language} word whose ordinary meaning is closest to it. Name in \`rejected\` the ordinary senses of your word that the reader must not bring to it.
7. \`aliases\`: the shorter forms of your name that a translator can use in a sentence, when the English aliases show such forms. Also add the other forms of the family (an adjective or plural that the papers use). Leave it out when there are none.

${guide}

## Output

Write one JSON file to \`${draft}\`. It has one key for each term id below (${batch.length} in total). \`meaning\`, \`confidence\`, and \`formConfidence\` are required. \`meaning\` is in English.

- \`confidence\`: how sure you are of the English meaning.
- \`formConfidence\`: how sure you are that your ${language} form carries that meaning, with no wrong reading. Rate it \`medium\` or \`low\` whenever a native reader can take the form in another sense.

\`\`\`json
{
  "${batch[0]!.id}": {
    "name": "…",
    "aliases": ["…"],
    "meaning": "One English sentence, with references (77:0.1).",
    "confidence": "high",
    "formConfidence": "medium",
    "rejected": [{ "form": "…", "reason": "…" }]
  }
}
\`\`\`

## Terms already done (${done.length})

${done.length ? done.map(([id, g]) => `- ${nameById.get(id) ?? id}: ${g.name}`).join("\n") : "(none yet)"}

## Terms to translate

${batch
	.map((e) =>
		[
			`### ${e.id}`,
			"",
			`- English: ${e.name}`,
			`- Type: ${e.key ? `key concept (${e.type})` : e.type}`,
			e.family ? `- Family: ${e.family}` : "",
			e.aliases.length ? `- English aliases: ${e.aliases.join("; ")}` : "",
			e.foreword ? `- Defined in the Foreword: read ${e.foreword} first` : "",
			e.description ? `- Summary (not the source): ${e.description}` : "",
			`- Paragraphs that use it: ${e.mentions}`,
		]
			.filter(Boolean)
			.join("\n"),
	)
	.join("\n\n")}
`;
	writeFileSync(join(dir, `${prefix}-${stamp}.packet.md`), packet);
	console.log(`Batch ${i + 1}: ${batch.length} terms (${families.join(", ") || "no family"}) → ${join(dir, `${prefix}-${stamp}.packet.md`)}`);
});

console.log(
	`${Object.keys(glossary).length}/${entities.length} done, ${todo.length} ${SECOND ? "need a second opinion" : "to do"}, ${batches.length} batches. Output: ${glossaryPath(lang)}`,
);
