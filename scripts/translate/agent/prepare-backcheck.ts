/**
 * prepare-backcheck.ts — Test glossary forms from the reader's side.
 *
 * Usage:
 *   bun scripts/translate/agent/prepare-backcheck.ts --lang=es           # blind readings
 *   bun scripts/translate/agent/prepare-backcheck.ts --lang=es --judge   # compare readings with meanings
 *
 * Step 1 (blind): a reader sees only the target-language forms, never the English or the meaning,
 * and says what each form suggests. Step 2 (judge): a judge compares that reading with the English
 * meaning. A mismatch puts the term on the human review list.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glossaryEntities, LANG_NAMES, loadGlossary, parseArgs, WORK_DIR } from "./lib.ts";

const BATCH_SIZE = 150;

const { lang, flags } = parseArgs();
const JUDGE = flags.has("--judge");
const language = LANG_NAMES[lang]!;
const dir = join(WORK_DIR, lang, "glossary");
const prefix = JUDGE ? "judge" : "blind";

const glossary = loadGlossary(lang);
const typeById = new Map(glossaryEntities().map((e) => [e.id, e]));
const todo = Object.entries(glossary).filter(([, g]) =>
	JUDGE ? g.backcheck?.reading && !g.backcheck.verdict : !g.backcheck,
);

mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".packet.md"))) {
	rmSync(join(dir, f));
}

for (let i = 0; i < todo.length; i += BATCH_SIZE) {
	const batch = todo.slice(i, i + BATCH_SIZE);
	const stamp = `${Date.now().toString(36)}-${String(i / BATCH_SIZE).padStart(2, "0")}`;
	const draft = join(dir, `${prefix}-${stamp}.draft.json`);
	// The ids are English slugs, so the blind reader sees numbers; the key maps them back.
	const keys = batch.map(([id], n) => [`t${n + 1}`, id] as const);
	if (!JUDGE) {
		writeFileSync(join(dir, `${prefix}-${stamp}.key.json`), JSON.stringify(Object.fromEntries(keys)));
	}
	const packet = JUDGE
		? `# Judge: does the ${language} form carry the English meaning?

For each term, you see the English meaning, the ${language} form, and what a blind ${language} reader understood from the form alone. Decide if a reader gets the intended meaning, or a wrong one.

- \`match\`: the reading fits the meaning, or is a fair first guess that the context of the papers completes.
- \`mismatch\`: the reading points to a different idea, or a misreading is likely enough to mislead.

Write one JSON file to \`${draft}\`: \`{ "<id>": { "verdict": "match", "note": "one short reason" } }\`.

${batch
	.map(
		([id, g]) =>
			`### ${id}\n\n- English: ${typeById.get(id)?.name}\n- Meaning: ${g.meaning}\n- ${language}: ${g.name}\n- Blind reading: ${g.backcheck!.reading}\n- Possible misreadings: ${(g.backcheck!.misreadings ?? []).join("; ") || "(none)"}`,
	)
	.join("\n\n")}
`
		: `# What does each ${language} term suggest?

You are a native ${language} reader with a good general education. You have never read the book these terms come from. Do not search for them and do not use any tool. Answer from your own sense of ${language}.

For each term, write in English:
- \`reading\`: what you would understand the term to mean, from the words alone. One sentence.
- \`misreadings\`: other senses a reader could take from it (an everyday sense, a religious sense, a regional sense). Leave it empty when there are none.

The type tells you only if it names a being, a place, a group, or an idea.

Write one JSON file to \`${draft}\`: \`{ "t1": { "reading": "…", "misreadings": ["…"] } }\`.

${batch.map(([id, g], n) => `- t${n + 1} (${typeById.get(id)?.type ?? "term"}): ${g.name}`).join("\n")}
`;
	writeFileSync(join(dir, `${prefix}-${stamp}.packet.md`), packet);
	console.log(`${prefix} batch: ${batch.length} terms → ${join(dir, `${prefix}-${stamp}.packet.md`)}`);
}
console.log(`${todo.length} terms ${JUDGE ? "to judge" : "for a blind reading"}`);
