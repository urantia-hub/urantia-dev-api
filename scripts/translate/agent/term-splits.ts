/**
 * term-splits.ts — List the coined terms that two or more drafts wrote in different forms.
 *
 * Usage: bun scripts/translate/agent/term-splits.ts --lang=es --papers=140-159
 *
 * Run it after a batch of drafts and before assembly: settle each split in the drafts,
 * because assembly keeps the first form that it sees for a term.
 */

import { existsSync, readFileSync } from "node:fs";
import { draftPath, parseArgs } from "./lib.ts";

const { lang, papers } = parseArgs();

// Agents write newTerms as a map, or as a list of { en, es } objects.
function entries(newTerms: unknown): [string, string][] {
	if (Array.isArray(newTerms)) {
		return newTerms
			.filter((t) => t && typeof t === "object")
			.map((t) => [
				String(t.en ?? t.english ?? t.term ?? ""),
				String(t.es ?? t.spanish ?? t.form ?? ""),
			]);
	}
	if (newTerms && typeof newTerms === "object")
		return Object.entries(newTerms).map(([k, v]) => [k, String(v)]);
	return [];
}

const forms = new Map<string, Map<string, number[]>>();
for (const paper of papers) {
	const path = draftPath(lang, paper);
	if (!existsSync(path)) continue;
	for (const [en, form] of entries(JSON.parse(readFileSync(path, "utf-8")).newTerms)) {
		const key = en.toLowerCase().trim();
		if (!key) continue;
		const byForm = forms.get(key) ?? new Map<string, number[]>();
		byForm.set(form.toLowerCase(), [...(byForm.get(form.toLowerCase()) ?? []), paper]);
		forms.set(key, byForm);
	}
}

let splits = 0;
for (const [en, byForm] of [...forms].sort()) {
	if (byForm.size < 2) continue;
	splits++;
	console.log(`${en}: ${[...byForm].map(([f, ps]) => `${f} (${ps.join(", ")})`).join(" | ")}`);
}
console.log(`${splits} split terms in ${papers.length} papers`);
