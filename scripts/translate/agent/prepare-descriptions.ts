/**
 * prepare-descriptions.ts — Write translation packets for the entity descriptions.
 *
 * Usage:
 *   bun scripts/translate/agent/prepare-descriptions.ts --lang=es
 *   bun scripts/translate/agent/prepare-descriptions.ts --lang=es --redo
 *
 * The descriptions are our own English text, so no published edition holds them and no copy check
 * runs. Each packet holds 100 entries, the glossary forms of the terms they use, and the rules.
 * --redo writes packets with only the entries that assemble-descriptions.ts did not accept.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type DescriptionEntry, descriptionEntries } from "./descriptions.ts";
import { LANG_NAMES, parseArgs, STYLE_GUIDE_DIR, termsInText, WORK_DIR } from "./lib.ts";

const { lang, flags } = parseArgs();
const language = LANG_NAMES[lang]!;
const REDO = flags.has("--redo");
const SIZE = 100;
const dir = join(WORK_DIR, lang, "descriptions");
mkdirSync(dir, { recursive: true });

const read = (path: string) => readFileSync(path, "utf-8");
const cleanRoom = read(join(import.meta.dir, "clean-room.md"));
const common = read(join(STYLE_GUIDE_DIR, "common.md"));
const guide = read(join(STYLE_GUIDE_DIR, `${lang}.md`));

let entries = descriptionEntries(lang);
let reasons = new Map<string, string>();
if (REDO) {
	const failedPath = join(dir, "failed.json");
	if (!existsSync(failedPath)) throw new Error("Run assemble-descriptions.ts first.");
	const failed: { id: string; detail: string }[] = JSON.parse(read(failedPath));
	reasons = new Map(failed.map((f) => [f.id, f.detail]));
	entries = entries.filter((e) => reasons.has(e.id));
}

function packet(chunk: DescriptionEntry[], output: string): string {
	const terms = termsInText(lang, chunk.map((e) => `${e.name}\n${e.description}`).join("\n"));
	const table = terms.length
		? [`| English | ${language} | Short forms |`, "|---|---|---|", ...terms.map((t) => `| ${t.en} | ${t.target} | ${t.aliases.join("; ")} |`)].join("\n")
		: "(none)";
	return `# Translate glossary descriptions into ${language}

You translate the short descriptions of a glossary of the Urantia Papers from English into ${language}. The descriptions are the glossary's own text. A reader sees one when they press a term in a paragraph. Your translation will be released as CC0.

${cleanRoom}

Output: write one JSON file to \`${output}\`, with one key for each entry id below (${chunk.length} in total):

\`\`\`json
{ "${chunk[0]!.id}": { "description": "…" } }
\`\`\`

- Translate the meaning of each description exactly. Keep its length and its plain, neutral voice: a reference work, not a sermon. Keep each reference (such as 1:0.1) as it is.
- Where the English says what the papers say ("the papers describe…"), keep that framing. Do not add a claim.
- Write each glossary term in its form from the table below. You can change number and gender to fit the sentence.
- An entry marked "no ${language} name yet" also needs \`"name"\`: the ${language} name of the term, chosen by the method in the style guide.
${REDO ? "- A check did not accept an earlier answer for these entries. The reason is under each entry. Translate again from the English.\n" : ""}
${common}

${guide}

## Glossary forms

${table}

## Entries

${chunk
	.map(
		(e) =>
			`### ${e.id}\n\n- English name: ${e.name}\n- ${language} name: ${e.target ?? `no ${language} name yet`}\n${reasons.has(e.id) ? `- Not accepted before: ${reasons.get(e.id)}\n` : ""}\n${e.description}`,
	)
	.join("\n\n")}
`;
}

const prefix = REDO ? `redo-${Date.now().toString(36)}` : "packet";
for (let i = 0; i < entries.length; i += SIZE) {
	const n = String(i / SIZE + 1).padStart(3, "0");
	const output = join(dir, `${prefix}-${n}.draft.json`);
	writeFileSync(join(dir, `${prefix}-${n}.packet.md`), packet(entries.slice(i, i + SIZE), output));
}
console.log(`${entries.length} entries in ${Math.ceil(entries.length / SIZE)} packets → ${dir}`);
