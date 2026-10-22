/**
 * decide-glossary.ts — Record a human decision on a glossary term. The decision locks the entry.
 *
 * Usage:
 *   bun scripts/translate/agent/decide-glossary.ts --lang=es --id=michael-of-nebadon \
 *     --name="Miguel de Nebadon" --by=Kelson [--aliases="Miguel;Cristo Miguel"] [--note="…"]
 *
 * Without --name, it keeps the current form and only locks it.
 *
 * A root (one form for an English word inside many terms):
 *   bun scripts/translate/agent/decide-glossary.ts --lang=es --root=staff --forms="personal" --by=Kelson [--requeue]
 *
 * --requeue removes every undecided term that breaks the root, so the next glossary batch
 * translates it again with the root in its packet.
 */

import { writeFileSync } from "node:fs";
import {
	glossaryEntities,
	glossaryPath,
	loadGlossary,
	loadRoots,
	parseArgs,
	rootsPath,
	rootViolations,
} from "./lib.ts";

const { lang, flags } = parseArgs();
const arg = (name: string) => {
	const a = process.argv.find((x) => x.startsWith(`--${name}=`));
	return a ? a.slice(name.length + 3) : undefined;
};
const id = arg("id");
const by = arg("by");
const root = arg("root");
const date = new Date().toISOString().slice(0, 10);
const note = arg("note");

if (root && by) {
	const roots = loadRoots(lang);
	const forms = arg("forms")?.split(";").filter(Boolean) ?? roots[root]?.forms;
	if (!forms?.length) {
		console.error(`${root} has no forms yet; give --forms`);
		process.exit(1);
	}
	roots[root] = { ...roots[root], forms, decision: { by, date, ...(note ? { note } : {}) } };
	const sortedRoots = Object.fromEntries(Object.entries(roots).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(rootsPath(lang), `${JSON.stringify(sortedRoots, null, "\t")}\n`);
	const glossary = loadGlossary(lang);
	const broken = rootViolations(glossary, { [root]: roots[root]! });
	console.log(`root ${root}: ${forms.join(", ")} (decided by ${by}); ${broken.length} terms do not use it`);
	for (const v of broken) {
		const locked = !!glossary[v.id]!.decision;
		console.log(`  ${v.en} → ${v.name}${locked ? " [decided, kept]" : flags.has("--requeue") ? " [requeued]" : ""}`);
		if (flags.has("--requeue") && !locked) delete glossary[v.id];
	}
	if (flags.has("--requeue")) writeFileSync(glossaryPath(lang), `${JSON.stringify(glossary, null, "\t")}\n`);
	process.exit(0);
}

if (!id || !by) {
	console.error("--id (or --root) and --by are required");
	process.exit(1);
}
if (!glossaryEntities().some((e) => e.id === id)) {
	console.error(`${id} is not a glossary term`);
	process.exit(1);
}

const glossary = loadGlossary(lang);
const old = glossary[id];
const name = arg("name") ?? old?.name;
if (!name) {
	console.error(`${id} has no form yet; give --name`);
	process.exit(1);
}
const aliases = arg("aliases")?.split(";").filter(Boolean) ?? old?.aliases;
const rejected =
	old && old.name !== name
		? [...(old.rejected ?? []), { form: old.name, reason: `replaced by a human decision` }]
		: old?.rejected;

glossary[id] = {
	...old,
	name,
	...(aliases?.length ? { aliases } : {}),
	...(rejected?.length ? { rejected } : {}),
	decision: { by, date, ...(note ? { note } : {}) },
};
const sorted = Object.fromEntries(Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(glossaryPath(lang), `${JSON.stringify(sorted, null, "\t")}\n`);
console.log(`${id}: "${old?.name ?? "(none)"}" → "${name}" (decided by ${by})`);
