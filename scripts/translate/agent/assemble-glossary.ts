/**
 * assemble-glossary.ts — Check the glossary drafts and merge them into glossary.json.
 *
 * Usage: bun scripts/translate/agent/assemble-glossary.ts --lang=es [--dry-run]
 *
 * Reads every .work/translate/<lang>/glossary/batch-*.draft.json. Merges valid entries,
 * then moves each merged draft to done/. Exits 1 when a draft has an error.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type GlossaryEntry,
	glossaryEntities,
	glossaryPath,
	loadGlossary,
	parseArgs,
	WORK_DIR,
} from "./lib.ts";

const { lang, flags } = parseArgs();
const DRY_RUN = flags.has("--dry-run");
const dir = join(WORK_DIR, lang, "glossary");
const drafts = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".draft.json")) : [];

const entities = new Map(glossaryEntities().map((e) => [e.id, e]));
const glossary = loadGlossary(lang);
let failed = 0;
let added = 0;

for (const file of drafts) {
	const draft: Record<string, GlossaryEntry> = JSON.parse(readFileSync(join(dir, file), "utf-8"));
	const errors: string[] = [];
	const warns: string[] = [];
	for (const [id, entry] of Object.entries(draft)) {
		const e = entities.get(id);
		if (!e) errors.push(`${id}: not a glossary term`);
		else if (!entry?.name?.trim()) errors.push(`${id}: no name`);
		else if (!entry.meaning?.trim()) errors.push(`${id}: no meaning`);
		else if (!["high", "medium", "low"].includes(entry.confidence ?? "")) {
			errors.push(`${id}: confidence must be high, medium, or low`);
		} else if (glossary[id] && glossary[id].name !== entry.name) {
			warns.push(
				`${id}: already "${glossary[id].name}", draft has "${entry.name}"; kept the first`,
			);
		}
	}
	console.log(
		`${file}: ${Object.keys(draft).length} terms, ${errors.length} errors, ${warns.length} warnings`,
	);
	for (const m of errors) console.log(`  error ${m}`);
	for (const m of warns) console.log(`  warn  ${m}`);
	if (errors.length) {
		failed++;
		continue;
	}
	for (const [id, entry] of Object.entries(draft)) {
		if (glossary[id]) continue;
		const aliases = (entry.aliases ?? []).filter((a) => a?.trim() && a !== entry.name);
		glossary[id] = {
			name: entry.name.trim(),
			...(aliases.length ? { aliases } : {}),
			meaning: entry.meaning!.trim(),
			confidence: entry.confidence,
			...(entry.rejected?.length ? { rejected: entry.rejected } : {}),
		};
		added++;
	}
	if (!DRY_RUN) {
		mkdirSync(join(dir, "done"), { recursive: true });
		renameSync(join(dir, file), join(dir, "done", file));
	}
}

// One English word, one translation: list English words that got two or more forms.
const byWord = new Map<string, Set<string>>();
for (const [id, g] of Object.entries(glossary)) {
	const e = entities.get(id);
	if (!e) continue;
	const enWords = e.name.split(/\s+/);
	const trWords = g.name.split(/\s+/);
	if (enWords.length === 1 && trWords.length === 1) {
		const k = enWords[0]!.toLowerCase().replace(/s$/, "");
		byWord.set(k, new Set([...(byWord.get(k) ?? []), trWords[0]!.toLowerCase()]));
	}
}
const split = [...byWord.entries()].filter(([, forms]) => forms.size > 1);
if (split.length) {
	console.log(`\nOne-word terms with more than one form (check that the difference is intended):`);
	for (const [w, forms] of split.slice(0, 40)) console.log(`  ${w}: ${[...forms].join(", ")}`);
}

const unsure = Object.entries(glossary).filter(([, g]) => g.confidence !== "high");
if (unsure.length) {
	console.log(`\nTerms for a human check (confidence below high): ${unsure.length}`);
	for (const [id, g] of unsure.slice(0, 60)) {
		console.log(`  ${g.confidence?.padEnd(6)} ${entities.get(id)?.name} → ${g.name}: ${g.meaning}`);
	}
}

const total = entities.size;
console.log(`\n${Object.keys(glossary).length}/${total} terms (${added} added this run)`);
if (!DRY_RUN && added) {
	const sorted = Object.fromEntries(
		Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b)),
	);
	writeFileSync(glossaryPath(lang), `${JSON.stringify(sorted, null, "\t")}\n`);
	console.log(`Wrote ${glossaryPath(lang)}`);
}
process.exit(failed ? 1 : 0);
