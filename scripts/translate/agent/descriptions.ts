/**
 * descriptions.ts — The entries and the checks for translated entity descriptions.
 * See prepare-descriptions.ts and assemble-descriptions.ts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGLISH_MARKERS, termPresent } from "./checks.ts";
import { loadGlossary, ROOT, type Term, termsInText } from "./lib.ts";

export type DescriptionEntry = {
	id: string;
	name: string;
	target: string | null;
	description: string;
};
export type DescriptionAnswer = { description: string; name?: string };
export type DescriptionIssue = {
	id: string;
	check: "missing" | "english" | "term" | "name";
	detail: string;
};

/** The entries the Hub shows: each entity whose sense is not "ordinary", with its clean target name. */
export function descriptionEntries(lang: string): DescriptionEntry[] {
	type Seed = { id: string; name: string; description: string | null; sense?: string };
	const seeds: Seed[] = JSON.parse(
		readFileSync(join(ROOT, "data/entities/seed-entities.json"), "utf-8"),
	);
	const glossary = loadGlossary(lang);
	return seeds
		.filter((s) => s.sense !== "ordinary" && s.description?.trim())
		.map((s) => ({
			id: s.id,
			name: s.name,
			target: glossary[s.id]?.name ?? null,
			description: s.description!,
		}));
}

/** Checks each answer against its entry. Answers for ids outside the packet are ignored. */
export function checkDescriptions(
	lang: string,
	entries: DescriptionEntry[],
	answers: Record<string, DescriptionAnswer>,
	// The glossary terms in an English text; a test passes its own, so it needs no source files.
	termsIn: (text: string) => Term[] = (text) => termsInText(lang, text),
): {
	issues: DescriptionIssue[];
	warnings: DescriptionIssue[];
	passed: Map<string, DescriptionAnswer>;
} {
	const issues: DescriptionIssue[] = [];
	// A term in another form is often right ("worship" of a cult is "culto"), so a person reads these.
	const warnings: DescriptionIssue[] = [];
	const passed = new Map<string, DescriptionAnswer>();
	for (const entry of entries) {
		const answer = answers[entry.id];
		const before = issues.length;
		const add = (check: DescriptionIssue["check"], detail: string) =>
			issues.push({ id: entry.id, check, detail });
		if (!answer?.description?.trim()) {
			add("missing", "no description");
			continue;
		}
		if (!entry.target && !answer.name?.trim())
			add("name", "no name for an entry with no glossary name");
		const words = answer.description.toLowerCase().match(/\p{L}+/gu) ?? [];
		const english = words.filter((w) => ENGLISH_MARKERS.has(w)).length;
		if (english >= 2) add("english", `${english} English function words`);
		for (const term of termsIn(entry.description)) {
			if (term.required && !termPresent(term, answer.description)) {
				warnings.push({
					id: entry.id,
					check: "term",
					detail: `"${term.en}" expected as "${term.target}"`,
				});
			}
		}
		if (issues.length === before) passed.set(entry.id, answer);
	}
	return { issues, warnings, passed };
}
