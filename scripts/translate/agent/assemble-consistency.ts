/**
 * assemble-consistency.ts — Merge the consistency reviewer's draft.
 *
 * Usage: bun scripts/translate/agent/assemble-consistency.ts --lang=es
 *
 * - `same` groups go to data/translations/<lang>/consistency.json, so the check stops listing them.
 * - Proposed roots go to data/translations/<lang>/roots.json. A root with a human decision is kept.
 * - Conflicts and roots are written to .work/translate/<lang>/consistency-review.md for a human.
 * No glossary term changes here. A human decides with decide-glossary.ts.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	consistencyPath,
	glossaryEntities,
	LANG_NAMES,
	loadConsistency,
	loadGlossary,
	loadRoots,
	parseArgs,
	type Root,
	rootsPath,
	WORK_DIR,
} from "./lib.ts";

type Draft = {
	same?: string[][];
	conflicts?: { ids: string[]; problem: string; fix?: Record<string, string> }[];
	roots?: Record<string, { forms: string[]; reason?: string; terms?: string[] }>;
	notSplits?: Record<string, string>;
};

const { lang } = parseArgs();
const dir = join(WORK_DIR, lang);
const draftPath = join(dir, "consistency.draft.json");
if (!existsSync(draftPath)) {
	console.error(`No draft at ${draftPath}`);
	process.exit(1);
}
const draft: Draft = JSON.parse(readFileSync(draftPath, "utf-8"));
const glossary = loadGlossary(lang);
const names = new Map(glossaryEntities().map((e) => [e.id, e.name]));
const known = (id: string) => names.has(id);

const errors = [
	...(draft.same ?? []).flat().filter((id) => !known(id)),
	...(draft.conflicts ?? []).flatMap((c) => [...c.ids, ...Object.keys(c.fix ?? {})]).filter((id) => !known(id)),
	...Object.values(draft.roots ?? {}).flatMap((r) => r.terms ?? []).filter((id) => !known(id)),
].map((id) => `unknown id ${id}`);
for (const [w, r] of Object.entries(draft.roots ?? {})) {
	if (!r.forms?.length) errors.push(`root ${w}: no forms`);
}
if (errors.length) {
	for (const e of errors.slice(0, 30)) console.log(`error ${e}`);
	process.exit(1);
}

const consistency = loadConsistency(lang);
const seen = new Set(consistency.same.map((g) => [...g].sort().join(" ")));
for (const g of draft.same ?? []) {
	const k = [...g].sort().join(" ");
	if (!seen.has(k)) consistency.same.push([...g].sort());
	seen.add(k);
}
writeFileSync(consistencyPath(lang), `${JSON.stringify(consistency, null, "\t")}\n`);

const roots = loadRoots(lang);
for (const [w, r] of Object.entries(draft.roots ?? {})) {
	if (roots[w]?.decision) continue;
	roots[w] = { forms: r.forms, ...(r.reason ? { reason: r.reason } : {}) } satisfies Root;
}
const sorted = Object.fromEntries(Object.entries(roots).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(rootsPath(lang), `${JSON.stringify(sorted, null, "\t")}\n`);

const show = (id: string) => `${names.get(id)} → ${glossary[id]?.name ?? "(none)"}${glossary[id]?.decision ? " [decided]" : ""}`;
const review = `# ${LANG_NAMES[lang]} glossary: consistency decisions

## Roots (${Object.keys(draft.roots ?? {}).length})

One ${LANG_NAMES[lang]} root for an English word inside many terms. Decide with:
\`bun scripts/translate/agent/decide-glossary.ts --lang=${lang} --root=<word> --forms="a;b" --by=<name> [--requeue]\`

${Object.entries(draft.roots ?? {})
	.map(
		([w, r]) =>
			`### ${w} → ${r.forms.join(", ")}\n\n${r.reason ?? ""}\n\nTerms to change:\n${(r.terms ?? []).map((id) => `- ${show(id)}`).join("\n") || "- (none)"}`,
	)
	.join("\n\n")}

## Conflicts (${draft.conflicts?.length ?? 0})

${(draft.conflicts ?? [])
	.map(
		(c) =>
			`- ${c.ids.map(show).join("; ")}\n  - Problem: ${c.problem}${Object.entries(c.fix ?? {})
				.map(([id, f]) => `\n  - Fix: ${names.get(id)} → ${f}`)
				.join("")}`,
	)
	.join("\n")}

## Not splits

${Object.entries(draft.notSplits ?? {}).map(([w, why]) => `- ${w}: ${why}`).join("\n")}
`;
writeFileSync(join(dir, "consistency-review.md"), review);
renameSync(draftPath, join(dir, `consistency.${Date.now().toString(36)}.done.json`));
console.log(
	`${draft.same?.length ?? 0} same groups, ${draft.conflicts?.length ?? 0} conflicts, ${Object.keys(draft.roots ?? {}).length} roots proposed\n→ ${join(dir, "consistency-review.md")}`,
);
