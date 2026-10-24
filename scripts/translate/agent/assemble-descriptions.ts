/**
 * assemble-descriptions.ts — Check the description drafts and merge the accepted ones.
 *
 * Usage:
 *   bun scripts/translate/agent/assemble-descriptions.ts --lang=es
 *
 * Reads every *.draft.json in .work/translate/<lang>/descriptions/ (a later redo answer replaces an
 * earlier one), writes the accepted descriptions and new names into
 * data/translations/<lang>/entity-translations.json, and lists the rest in failed.json for --redo.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkDescriptions, type DescriptionAnswer, descriptionEntries } from "./descriptions.ts";
import { parseArgs, ROOT, WORK_DIR } from "./lib.ts";

const { lang } = parseArgs();
const dir = join(WORK_DIR, lang, "descriptions");
const drafts = readdirSync(dir)
	.filter((f) => f.endsWith(".draft.json"))
	.sort((a, b) => (a.startsWith("redo") === b.startsWith("redo") ? a.localeCompare(b) : a.startsWith("redo") ? 1 : -1));
const answers: Record<string, DescriptionAnswer> = {};
for (const f of drafts) Object.assign(answers, JSON.parse(readFileSync(join(dir, f), "utf-8")));

const entries = descriptionEntries(lang);
const { issues, warnings, passed } = checkDescriptions(lang, entries, answers);

type Row = { entityId: string; language: string; source: string; version: number; name: string; aliases: string[]; description: string | null; confidence: string };
const file = join(ROOT, `data/translations/${lang}/entity-translations.json`);
const rows: Row[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : [];
const byId = new Map(rows.map((r) => [r.entityId, r]));
let added = 0;
for (const [id, answer] of passed) {
	const row = byId.get(id);
	if (row) row.description = answer.description.trim();
	else if (answer.name?.trim()) {
		// A name chosen here had no glossary review, so it is marked for a look.
		byId.set(id, { entityId: id, language: lang, source: "urantia.dev", version: 1, name: answer.name.trim(), aliases: [], description: answer.description.trim(), confidence: "needs_manual" });
		added++;
	}
}
const out = [...byId.values()].sort((a, b) => a.entityId.localeCompare(b.entityId));
writeFileSync(file, `${JSON.stringify(out, null, "\t")}\n`);

const failed = [...new Map(issues.map((i) => [i.id, i])).values()].map((i) => ({
	id: i.id,
	detail: issues.filter((x) => x.id === i.id).map((x) => x.detail).join("; "),
}));
writeFileSync(join(dir, "failed.json"), `${JSON.stringify(failed, null, 2)}\n`);
writeFileSync(join(dir, "warnings.json"), `${JSON.stringify(warnings, null, 2)}\n`);
const counts = issues.reduce<Record<string, number>>((c, i) => ({ ...c, [i.check]: (c[i.check] ?? 0) + 1 }), {});
console.log(`${passed.size} of ${entries.length} accepted, ${added} new names, ${failed.length} to redo ${JSON.stringify(counts)}, ${warnings.length} term warnings to read`);
