/**
 * checks.ts — Automatic checks for one translated paper. No model calls.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type EnglishPaper,
	fold,
	pad,
	stripTags,
	type Term,
	termsForRefs,
	URANTIAPEDIA_DIR,
} from "./lib.ts";

export type Issue = { ref: string; level: "error" | "warn"; check: string; detail: string };

// Target length / English length, plain text, for paragraphs of 120+ characters.
const LENGTH_RATIO: Record<string, [number, number]> = {
	es: [0.95, 1.6],
	pt: [0.95, 1.6],
	fr: [0.95, 1.65],
	de: [0.95, 1.6],
	nl: [0.9, 1.5],
	ko: [0.3, 0.9],
};

// Share of the translation's 6-word runs found in one existing edition. Independent human editions
// share a median of 0.13-0.34 per paragraph and a 90th percentile up to 0.58; a copy shares 0.8+.
const COPY_LIMIT_PARAGRAPH = 0.6;
const COPY_MIN_SHINGLES = 15;
export const COPY_LIMIT_PAPER_MEDIAN = { warn: 0.35, error: 0.5 };

const ENGLISH_MARKERS = new Set(
	"the and which that with is are was were have has this these those upon from shall would their".split(
		" ",
	),
);

function tagSignature(html: string, names: string[]): string[] {
	const re = new RegExp(`<(${names.join("|")})(\\s[^>]*)?>`, "g");
	return [...html.matchAll(re)].map((m) => `${m[1]}${m[2] ?? ""}`);
}

function numbers(text: string): string[] {
	return (text.match(/\d[\d,.\s]*\d|\d/g) ?? []).map((n) => n.replace(/[,.\s]/g, ""));
}

/** True when each long word of the term appears by its first 5 letters (allows plural and gender). */
function termPresent(term: Term, text: string): boolean {
	const hay = fold(text);
	return [term.target, ...term.aliases].some((form) =>
		fold(form)
			.split(/[\s-]+/)
			.filter((w) => w.length >= 4)
			.every((w) => hay.includes(w.slice(0, 5))),
	);
}

function shingles(text: string, n = 6): Set<string> {
	const words = fold(text).match(/\p{L}+/gu) ?? [];
	const out = new Set<string>();
	for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
	return out;
}

const editionCache = new Map<string, Map<string, string>[]>();

/** Existing editions in the target language, used only to detect copying. Never sent to a translator. */
function loadEditions(lang: string, paper: number): Map<string, string>[] {
	const key = `${lang}:${paper}`;
	if (editionCache.has(key)) return editionCache.get(key)!;
	const editions: Map<string, string>[] = [];
	if (existsSync(URANTIAPEDIA_DIR)) {
		const dirs = readdirSync(URANTIAPEDIA_DIR).filter(
			(d) => (d === `book-${lang}` || d.startsWith(`book-${lang}-`)) && !d.endsWith("footnotes"),
		);
		for (const dir of dirs) {
			const file = join(URANTIAPEDIA_DIR, dir, `Doc${pad(paper)}.json`);
			if (!existsSync(file)) continue;
			type Doc = { sections: { pars: { par_ref: string; par_content: string }[] }[] };
			const doc: Doc = JSON.parse(readFileSync(file, "utf-8"));
			editions.push(
				new Map(
					doc.sections.flatMap((s) => s.pars.map((p) => [p.par_ref, stripTags(p.par_content)])),
				),
			);
		}
	}
	editionCache.set(key, editions);
	return editions;
}

export function copyScore(lang: string, paper: number, ref: string, text: string): number {
	const ours = shingles(text);
	if (ours.size < COPY_MIN_SHINGLES) return 0;
	let max = 0;
	for (const edition of loadEditions(lang, paper)) {
		const theirs = edition.get(ref);
		if (!theirs) continue;
		const other = shingles(theirs);
		let shared = 0;
		for (const s of ours) if (other.has(s)) shared++;
		max = Math.max(max, shared / ours.size);
	}
	return max;
}

export function editionsAvailable(lang: string, paper: number): number {
	return loadEditions(lang, paper).length;
}

export function checkParagraph(
	lang: string,
	paper: number,
	en: EnglishPaper["paragraphs"][number],
	html: string | undefined,
): Issue[] {
	const ref = en.ref;
	const issues: Issue[] = [];
	const add = (level: Issue["level"], check: string, detail: string) =>
		issues.push({ ref, level, check, detail });

	if (!html?.trim()) {
		add("error", "missing", "no translation");
		return issues;
	}
	const text = stripTags(html);

	const spansEn = tagSignature(en.htmlText, ["span"]).join(" ");
	const spansTr = tagSignature(html, ["span"]).join(" ");
	if (spansEn !== spansTr) add("error", "tags", `span tags differ: ${spansEn} | ${spansTr}`);
	for (const tag of ["em", "sup"]) {
		const a = tagSignature(en.htmlText, [tag]).length;
		const b = tagSignature(html, [tag]).length;
		if (a !== b) add("warn", "tags", `<${tag}> count ${a} in English, ${b} in translation`);
	}
	if ((html.match(/</g) ?? []).length !== (html.match(/>/g) ?? []).length) {
		add("error", "tags", "broken tag");
	}

	const missingNumbers = numbers(en.text).filter((n) => !numbers(text).includes(n));
	if (missingNumbers.length) add("warn", "numbers", `missing: ${missingNumbers.join(", ")}`);

	const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
	const english = words.filter((w) => ENGLISH_MARKERS.has(w)).length;
	if (english >= 6) add("error", "english", `${english} English function words`);
	else if (english >= 3) add("warn", "english", `${english} English function words`);

	const [lo, hi] = LENGTH_RATIO[lang] ?? [0.5, 2];
	if (en.text.length >= 120) {
		const ratio = text.length / en.text.length;
		if (ratio < lo || ratio > hi) add("warn", "length", `ratio ${ratio.toFixed(2)}`);
	}

	// The entity map also tags implied mentions, so check only terms written in the English.
	const englishText = en.text.toLowerCase();
	for (const term of termsForRefs(lang, [ref])) {
		const written = term.enForms.some((f) =>
			new RegExp(`\\b${f.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(englishText),
		);
		if (term.required && written && !termPresent(term, text)) {
			add("warn", "term", `"${term.en}" expected as "${term.target}"`);
		}
	}

	const score = copyScore(lang, paper, ref, text);
	if (score > COPY_LIMIT_PARAGRAPH) {
		add("error", "copy", `${Math.round(score * 100)}% matches an existing edition`);
	}

	return issues;
}

export function checkTitle(sourceId: string, title: string | undefined): Issue[] {
	if (!title?.trim())
		return [{ ref: sourceId, level: "error", check: "missing", detail: "no title" }];
	return [];
}
