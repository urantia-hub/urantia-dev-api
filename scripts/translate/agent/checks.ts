/**
 * checks.ts — Automatic checks for one translated paper. No model calls.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type EnglishPaper,
	fold,
	loadTerms,
	pad,
	stripTags,
	type Term,
	termsInText,
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
export const COPY_LIMIT_PARAGRAPH = 0.6;
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
// The running text drops an index note and an inverted tail: "Miguel (el original)", "Miguel, orden de".
const runningForm = (form: string) => form.replace(/\s*\([^)]*\)\s*$/, "").split(", ")[0]!;

function termPresent(term: Term, text: string): boolean {
	const hay = fold(text);
	return [term.target, ...term.aliases].some((form) =>
		fold(runningForm(form))
			.split(/[\s-]+/)
			.filter((w) => w.length >= 4)
			.every((w) => hay.includes(w.slice(0, 5))),
	);
}

const glossaryCache = new Map<string, Map<string, string[][]>>();

/** The glossary's target forms of two or more words, by first word, longest first. */
function glossaryForms(lang: string): Map<string, string[][]> {
	if (glossaryCache.has(lang)) return glossaryCache.get(lang)!;
	const byFirst = new Map<string, string[][]>();
	for (const t of loadTerms(lang).byEntity.values()) {
		for (const form of [t.target, ...t.aliases]) {
			const ws = fold(form).match(/\p{L}+/gu) ?? [];
			if (ws.length >= 2) byFirst.set(ws[0]!, [...(byFirst.get(ws[0]!) ?? []), ws]);
		}
	}
	for (const list of byFirst.values()) list.sort((a, b) => b.length - a.length);
	glossaryCache.set(lang, byFirst);
	return byFirst;
}

/**
 * The words of a text, with each glossary form of two or more words as one word. The glossary fixes
 * those words, so a list of titles (0:2.13) matches every edition; as one word, a name weighs as one.
 */
function collapsedWords(lang: string, text: string): string[] {
	const ws = fold(text).match(/\p{L}+/gu) ?? [];
	const forms = glossaryForms(lang);
	const out: string[] = [];
	for (let i = 0; i < ws.length; ) {
		const f = forms.get(ws[i]!)?.find((f) => f.every((w, j) => ws[i + j] === w));
		out.push(f ? f.join("_") : ws[i]!);
		i += f ? f.length : 1;
	}
	return out;
}

function shingles(words: string[], n = 6): Set<string> {
	const out = new Set<string>();
	for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
	return out;
}

const editionCache = new Map<string, Map<string, string>[]>();

/** The edition folders on disk for a language, e.g. book-es, book-es-1993. */
export function editionDirs(lang: string): string[] {
	if (!existsSync(URANTIAPEDIA_DIR)) return [];
	return readdirSync(URANTIAPEDIA_DIR).filter(
		(d) => (d === `book-${lang}` || d.startsWith(`book-${lang}-`)) && !d.endsWith("footnotes"),
	);
}

/** One existing edition of a paper as plain text by reference. Never sent to a translator. */
export function loadEdition(dir: string, paper: number): Map<string, string> | null {
	const file = join(URANTIAPEDIA_DIR, dir, `Doc${pad(paper)}.json`);
	if (!existsSync(file)) return null;
	type Doc = { sections: { pars: { par_ref: string; par_content: string }[] }[] };
	const doc: Doc = JSON.parse(readFileSync(file, "utf-8"));
	return new Map(
		doc.sections.flatMap((s) => s.pars.map((p) => [p.par_ref, stripTags(p.par_content)])),
	);
}

/** Existing editions in the target language, used only to detect copying. */
function loadEditions(lang: string, paper: number): Map<string, string>[] {
	const key = `${lang}:${paper}`;
	if (editionCache.has(key)) return editionCache.get(key)!;
	const editions = editionDirs(lang)
		.map((d) => loadEdition(d, paper))
		.filter((e): e is Map<string, string> => !!e);
	editionCache.set(key, editions);
	return editions;
}

export function copyScore(lang: string, paper: number, ref: string, text: string): number {
	const ours = shingles(collapsedWords(lang, text));
	if (ours.size < COPY_MIN_SHINGLES) return 0;
	let max = 0;
	for (const edition of loadEditions(lang, paper)) {
		const theirs = edition.get(ref);
		if (!theirs) continue;
		const other = shingles(collapsedWords(lang, theirs));
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

	for (const term of termsInText(lang, en.text)) {
		if (term.required && !termPresent(term, text)) {
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
