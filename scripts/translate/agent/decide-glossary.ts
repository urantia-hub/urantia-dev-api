/**
 * decide-glossary.ts — Record a human decision on a glossary term. The decision locks the entry.
 *
 * Usage:
 *   bun scripts/translate/agent/decide-glossary.ts --lang=es --id=michael-of-nebadon \
 *     --name="Miguel de Nebadon" --by=Kelson [--aliases="Miguel;Cristo Miguel"] [--note="…"]
 *
 * Without --name, it keeps the current form and only locks it.
 */

import { writeFileSync } from "node:fs";
import { glossaryEntities, glossaryPath, loadGlossary, parseArgs } from "./lib.ts";

const { lang } = parseArgs();
const arg = (name: string) => {
	const a = process.argv.find((x) => x.startsWith(`--${name}=`));
	return a ? a.slice(name.length + 3) : undefined;
};
const id = arg("id");
const by = arg("by");
if (!id || !by) {
	console.error("--id and --by are required");
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
	decision: { by, date: new Date().toISOString().slice(0, 10), ...(arg("note") ? { note: arg("note") } : {}) },
};
const sorted = Object.fromEntries(Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(glossaryPath(lang), `${JSON.stringify(sorted, null, "\t")}\n`);
console.log(`${id}: "${old?.name ?? "(none)"}" → "${name}" (decided by ${by})`);
