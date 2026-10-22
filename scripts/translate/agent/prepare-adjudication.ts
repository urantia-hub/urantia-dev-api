/**
 * prepare-adjudication.ts — Write packets for an agent to rule on each flagged glossary term.
 *
 * Usage: bun scripts/translate/agent/prepare-adjudication.ts --lang=es [--force]
 *
 * A term is flagged when a check raised a doubt (low confidence, a second translator disagreed,
 * the blind reading did not match, or the translator left a note). The adjudicator sees all the
 * evidence and chooses one form. It runs after the second opinions and the back-check, so a term
 * without them waits; --force includes it anyway. Merge with assemble-glossary.ts.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	glossaryEntities,
	LANG_NAMES,
	loadGlossary,
	loadRoots,
	needsRuling,
	parseArgs,
	STYLE_GUIDE_DIR,
	WORK_DIR,
} from "./lib.ts";

const BATCH_SIZE = 40;

const { lang, flags } = parseArgs();
const FORCE = flags.has("--force");
const language = LANG_NAMES[lang]!;
const dir = join(WORK_DIR, lang, "glossary");
const glossary = loadGlossary(lang);
const roots = loadRoots(lang);
const entities = glossaryEntities();
const byId = new Map(entities.map((e) => [e.id, e]));

const flagged = Object.entries(glossary).filter(([, g]) => needsRuling(g));
const ready = flagged.filter(([id, g]) => {
	if (FORCE) return true;
	const wantsSecond = byId.get(id)?.key || g.confidence !== "high" || g.formConfidence !== "high";
	return !!g.backcheck?.verdict && (!wantsSecond || !!g.second);
});

mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir).filter((f) => f.startsWith("adjud") && f.endsWith(".packet.md"))) {
	rmSync(join(dir, f));
}

const cleanRoom = readFileSync(join(import.meta.dir, "clean-room.md"), "utf-8");
const method = readFileSync(join(import.meta.dir, "meaning-first.md"), "utf-8");
const guidePath = join(STYLE_GUIDE_DIR, `${lang}.md`);
const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf-8") : "";
const others = Object.entries(glossary)
	.map(([id, g]) => `- ${byId.get(id)?.name ?? id}: ${g.name}`)
	.join("\n");

for (let i = 0; i < ready.length; i += BATCH_SIZE) {
	const batch = ready.slice(i, i + BATCH_SIZE);
	const stamp = `${Date.now().toString(36)}-${String(i / BATCH_SIZE).padStart(2, "0")}`;
	const draft = join(dir, `adjud-${stamp}.draft.json`);
	const packet = `# Rule on flagged ${language} glossary terms

Each term below has a doubt that a check raised. No human reviews these terms before they are published, so your ruling is the final choice until a reader reports a problem. Choose the form that is most truthful to what the authors meant, and that a ${language} reader is least likely to misread.

${cleanRoom}

${method}

## What to do for each term

1. Read the evidence: the meaning, the first form, the rejected forms, the second translator's form, the blind reading, the judge's verdict, and the notes.
2. If you need more, check the meaning in the papers with the urantia.dev MCP tools (English only).
3. Choose one form. It can be the first form, the second translator's form, or a new form when both have a real problem.
4. Check that your form follows the fixed roots, and that no other term in the full list uses it for a different thing.
5. Write one or two sentences of reason. Name the evidence that decided it.

Keep the first form when the doubt is small and no candidate is clearly better. A change has a cost: translators and readers learn one form.

${guide}

## Output

Write one JSON file to \`${draft}\`: \`{ "<id>": { "name": "…", "aliases": ["…"], "reason": "…" } }\`. Give \`aliases\` only when they change. Include every term below (${batch.length}).

## Fixed roots

${Object.entries(roots).map(([w, r]) => `- ${w}: ${r.forms.join(", ")}`).join("\n") || "(none)"}

## Terms to rule on

${batch
	.map(([id, g]) => {
		const e = byId.get(id);
		return [
			`### ${id}`,
			"",
			`- English: ${e?.name} (${e?.type}${e?.key ? ", key concept" : ""}; used in ${e?.mentions} paragraphs)`,
			`- Meaning: ${g.meaning} (confidence ${g.confidence})`,
			`- First form: ${g.name}${g.aliases?.length ? ` (also: ${g.aliases.join("; ")})` : ""} (form confidence ${g.formConfidence ?? "not rated"})`,
			...(g.rejected ?? []).map((r) => `- Rejected "${r.form}": ${r.reason}`),
			g.second ? `- Second translator: ${g.second.name} (${g.second.agree ? "agrees" : "differs"}). Its meaning: ${g.second.meaning}` : "",
			g.backcheck ? `- Blind reader understood: ${g.backcheck.reading}` : "",
			g.backcheck?.misreadings?.length ? `- Possible misreadings: ${g.backcheck.misreadings.join("; ")}` : "",
			g.backcheck?.verdict ? `- Judge: ${g.backcheck.verdict}${g.backcheck.note ? `, ${g.backcheck.note}` : ""}` : "",
			g.note ? `- Translator's note: ${g.note}` : "",
			...(g.forcedChoices ?? []).map((c) => `- Forced choice: ${c}`),
		]
			.filter(Boolean)
			.join("\n");
	})
	.join("\n\n")}

## The full glossary, for collisions

${others}
`;
	writeFileSync(join(dir, `adjud-${stamp}.packet.md`), packet);
	console.log(`adjud batch: ${batch.length} terms → ${join(dir, `adjud-${stamp}.packet.md`)}`);
}
console.log(`${flagged.length} flagged without a ruling; ${ready.length} ready${FORCE ? " (forced)" : ""}`);
