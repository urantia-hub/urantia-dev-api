/**
 * lib.ts — Shared loaders and paths for the agent translation workflow.
 * See scripts/translate/agent/README.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "../../..");
// The source texts live next to the repo checkout; URANTIA_MISC overrides it for worktrees.
const MISC = process.env.URANTIA_MISC ?? join(ROOT, "../misc");
export const ENG_DIR = join(MISC, "urantia-papers-json/data/json/eng");
export const URANTIAPEDIA_DIR = join(MISC, "urantiapedia/input/json");
export const WORK_DIR = join(ROOT, ".work/translate");
export const STYLE_GUIDE_DIR = join(import.meta.dir, "style-guides");

export const LANG_NAMES: Record<string, string> = {
	es: "Spanish",
	pt: "Portuguese",
	fr: "French",
	de: "German",
	ko: "Korean",
	nl: "Dutch",
};

export const PAPER_NUMBERS = Array.from({ length: 197 }, (_, i) => i);

// Entity types whose names are fixed terms. Concepts are fixed only when capitalized.
const FIXED_TYPES = new Set(["being", "place", "order", "race", "religion"]);

export type EnglishParagraph = {
	globalId: string;
	ref: string;
	sectionId: string;
	text: string;
	htmlText: string;
};

export type EnglishPaper = {
	paper: number;
	paperId: string;
	title: string;
	sections: { id: string; title: string | null }[];
	paragraphs: EnglishParagraph[];
};

export type ParagraphTranslation = {
	paragraphId: string;
	globalId: string;
	standardReferenceId: string;
	language: string;
	version: number;
	text: string;
	htmlText: string;
	source: string;
	confidence: string;
};

export type TitleTranslation = {
	sourceType: "paper" | "section";
	sourceId: string;
	language: string;
	version: number;
	title: string;
	source: string;
	confidence: string;
};

export type Term = {
	en: string;
	/** The English name and its English aliases. */
	enForms: string[];
	target: string;
	aliases: string[];
	type: string;
	required: boolean;
};

/** A draft is what a translator (agent or person) writes for one paper. */
export type Draft = {
	paperTitle: string;
	sectionTitles: Record<string, string>;
	paragraphs: Record<string, string>;
	/** Coined terms not in the glossary, as the translator chose to write them. */
	newTerms?: Record<string, string>;
};

export function pad(paper: number): string {
	return String(paper).padStart(3, "0");
}

export function parseArgs(): { lang: string; papers: number[]; flags: Set<string> } {
	const get = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
	const lang = get("lang") ?? "";
	if (!LANG_NAMES[lang]) {
		console.error(`--lang must be one of: ${Object.keys(LANG_NAMES).join(", ")}`);
		process.exit(1);
	}
	return { lang, papers: parsePapers(get("paper") ?? get("papers")), flags: new Set(process.argv) };
}

/** "1,100,196" or "0-10" or undefined (all papers). */
export function parsePapers(arg: string | undefined): number[] {
	if (!arg) return PAPER_NUMBERS;
	return arg.split(",").flatMap((part) => {
		const [a, b] = part.split("-").map(Number);
		if (b === undefined) return [a!];
		return Array.from({ length: b - a! + 1 }, (_, i) => a! + i);
	});
}

export function loadEnglishPaper(paper: number): EnglishPaper {
	type Node = {
		globalId: string;
		type: string;
		text: string | null;
		htmlText: string | null;
		standardReferenceId: string | null;
		paperId: string;
		paperTitle: string | null;
		paperSectionId: string | null;
		sectionTitle: string | null;
	};
	const nodes: Node[] = JSON.parse(readFileSync(join(ENG_DIR, `${pad(paper)}.json`), "utf-8"));
	const head = nodes.find((n) => n.type === "paper")!;
	return {
		paper,
		paperId: head.paperId,
		title: head.paperTitle ?? "",
		sections: nodes
			.filter((n) => n.type === "section")
			.map((n) => ({ id: n.paperSectionId!, title: n.sectionTitle })),
		paragraphs: nodes
			.filter((n) => n.type === "paragraph" && n.text && n.htmlText)
			.map((n) => ({
				globalId: n.globalId,
				ref: n.standardReferenceId!,
				sectionId: n.paperSectionId!,
				text: n.text!,
				htmlText: n.htmlText!,
			})),
	};
}

export function fold(s: string): string {
	return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// The stored aliases are often loose synonyms. Keep only shorter forms of the name ("Ajustador").
function isShortForm(alias: string, name: string): boolean {
	const stems = fold(name)
		.split(/[\s-]+/)
		.map((w) => w.slice(0, 5));
	return fold(alias)
		.split(/[\s-]+/)
		.filter((w) => w.length >= 4)
		.every((w) => stems.includes(w.slice(0, 5)));
}

let termIndex: { byEntity: Map<string, Term>; byRef: Map<string, string[]> } | null = null;

/** Glossary terms from the entity translations, keyed to the paragraphs that mention them. */
export function loadTerms(lang: string): {
	byEntity: Map<string, Term>;
	byRef: Map<string, string[]>;
} {
	if (termIndex) return termIndex;
	type Seed = { id: string; name: string; type: string; aliases: string[] };
	type Translated = { entityId: string; name: string; aliases: string[] | null };
	const seeds: Seed[] = JSON.parse(
		readFileSync(join(ROOT, "data/entities/seed-entities.json"), "utf-8"),
	);
	const translatedPath = join(ROOT, `data/translations/${lang}/entity-translations.json`);
	const translated: Translated[] = existsSync(translatedPath)
		? JSON.parse(readFileSync(translatedPath, "utf-8"))
		: [];
	const targetById = new Map(translated.map((t) => [t.entityId, t]));

	const byEntity = new Map<string, Term>();
	for (const seed of seeds) {
		const t = targetById.get(seed.id);
		if (!t || /^[\d\s.,:-]+$/.test(seed.name)) continue;
		const capitalized = /^[A-Z]/.test(seed.name);
		byEntity.set(seed.id, {
			en: seed.name,
			enForms: [seed.name, ...(seed.aliases ?? [])].filter(Boolean),
			target: t.name,
			aliases: (t.aliases ?? []).filter((a) => a && a !== t.name && isShortForm(a, t.name)),
			type: seed.type,
			required: FIXED_TYPES.has(seed.type) || (seed.type === "concept" && capitalized),
		});
	}

	type Mention = { id: string };
	const mentions: Record<string, Mention[]> = JSON.parse(
		readFileSync(join(ROOT, "data/entities/paragraph-entities.json"), "utf-8"),
	);
	const byRef = new Map(
		Object.entries(mentions).map(([ref, list]) => [ref, list.map((m) => m.id)]),
	);
	termIndex = { byEntity, byRef };
	return termIndex;
}

/** Terms mentioned in the given paragraph refs, required terms first. */
export function termsForRefs(lang: string, refs: string[]): Term[] {
	const { byEntity, byRef } = loadTerms(lang);
	const ids = new Set(refs.flatMap((r) => byRef.get(r) ?? []));
	return [...ids]
		.map((id) => byEntity.get(id))
		.filter((t): t is Term => !!t)
		.sort((a, b) => Number(b.required) - Number(a.required) || a.en.localeCompare(b.en));
}

export function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, "");
}

export function draftPath(lang: string, paper: number, candidate = "main"): string {
	return join(WORK_DIR, lang, candidate, `paper-${pad(paper)}.draft.json`);
}

export function outputPath(lang: string, paper: number): string {
	return join(ROOT, `data/translations/${lang}/paragraphs/paper-${pad(paper)}.json`);
}

/** Term forms chosen during translation, shared by every later paper. */
export function termDecisionsPath(lang: string): string {
	return join(ROOT, `data/translations/${lang}/term-decisions.json`);
}

export function loadTermDecisions(lang: string): Record<string, string> {
	const path = termDecisionsPath(lang);
	return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

export function titlesPath(lang: string): string {
	return join(ROOT, `data/translations/${lang}/titles.json`);
}
