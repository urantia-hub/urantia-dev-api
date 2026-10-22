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

// Entity types whose names get a fixed translation. Concepts do only when capitalized.
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
	meaning?: string;
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
	/** Places where the target language forced a choice that the English leaves open. */
	forcedChoices?: { ref: string; choice: string; reason: string }[];
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

export type GlossaryEntity = {
	id: string;
	name: string;
	type: string;
	aliases: string[];
	description: string;
	mentions: number;
	/** Word family, so a coined root is decided once (morontia, morontial, mota). */
	family?: string;
	/** Foreword section that defines the term, e.g. "0:5". */
	foreword?: string;
	/** A key concept: a word that the papers use in a special sense. */
	key?: boolean;
};

export type Confidence = "high" | "medium" | "low";

/** One clean glossary entry: the target-language name, why it was chosen, and its checks. */
export type GlossaryEntry = {
	name: string;
	aliases?: string[];
	/** The English meaning in one sentence, with references. */
	meaning?: string;
	/** How sure the translator is of the English meaning. */
	confidence?: Confidence;
	/** How sure the translator is that the form carries that meaning with no wrong reading. */
	formConfidence?: Confidence;
	/** Forms considered and rejected, with a short reason each. */
	rejected?: { form: string; reason: string }[];
	/** An independent second translator's choice, made without seeing this one. */
	second?: { name: string; meaning: string; formConfidence?: Confidence; agree: boolean };
	/** What a reader of the target language understands from the form alone, and a judge's verdict. */
	backcheck?: { reading: string; misreadings?: string[]; verdict?: "match" | "mismatch"; note?: string };
	/** A note from the translator to the reviewer. */
	note?: string;
	/** Places where the target language forced a choice that the English leaves open. */
	forcedChoices?: string[];
	/** A human decision. It locks the entry. */
	decision?: { by: string; date: string; note?: string };
	/** An agent's ruling on a flagged entry. A human decision or a later report can replace it. */
	adjudicated?: { date: string; reason: string; previous?: string };
};

export function glossaryPath(lang: string): string {
	return join(ROOT, `data/translations/${lang}/glossary.json`);
}

function loadMentions(): Record<string, { id: string }[]> {
	return JSON.parse(readFileSync(join(ROOT, "data/entities/paragraph-entities.json"), "utf-8"));
}

type KeyConcepts = {
	families: Record<string, string[]>;
	concepts: { id: string; en: string; family: string; foreword?: string }[];
};

function loadKeyConcepts(): KeyConcepts {
	return JSON.parse(readFileSync(join(ROOT, "data/translations/key-concepts.json"), "utf-8"));
}

function wordRegex(word: string): RegExp {
	const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`\\b${escaped}(s|es|al|ally|ity|ities|ed|ing)?\\b`, "i");
}

let corpusRefs: Map<string, string[]> | null = null;

/** Paragraph refs that contain each key concept that is not an entity, by text match. */
function keyConceptRefs(): Map<string, string[]> {
	if (corpusRefs) return corpusRefs;
	const concepts = loadKeyConcepts().concepts.filter((c) => c.id.startsWith("kc-"));
	const regexes = concepts.map((c) => [c.id, wordRegex(c.en.replace(/ \(.*\)$/, ""))] as const);
	corpusRefs = new Map(concepts.map((c) => [c.id, []]));
	for (const paper of PAPER_NUMBERS) {
		for (const p of loadEnglishPaper(paper).paragraphs) {
			for (const [id, re] of regexes) if (re.test(p.text)) corpusRefs.get(id)!.push(p.ref);
		}
	}
	return corpusRefs;
}

let entityCache: GlossaryEntity[] | null = null;

/**
 * The terms that need a fixed translation: names, places, orders, capitalized concepts,
 * and the key concepts in data/translations/key-concepts.json.
 */
export function glossaryEntities(): GlossaryEntity[] {
	if (entityCache) return entityCache;
	type Seed = { id: string; name: string; type: string; aliases: string[]; description: string };
	const seeds: Seed[] = JSON.parse(
		readFileSync(join(ROOT, "data/entities/seed-entities.json"), "utf-8"),
	);
	const counts = new Map<string, number>();
	for (const list of Object.values(loadMentions())) {
		for (const m of list) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
	}
	const { families, concepts } = loadKeyConcepts();
	const keyById = new Map(concepts.map((c) => [c.id, c]));
	const familyOf = (name: string) =>
		Object.entries(families).find(([, roots]) => roots.some((r) => name.includes(r)))?.[0];

	const out: GlossaryEntity[] = seeds
		.filter(
			(e) =>
				FIXED_TYPES.has(e.type) ||
				(e.type === "concept" && /^[A-Z]/.test(e.name)) ||
				keyById.has(e.id),
		)
		.filter((e) => !/^[\d\s.,:-]+$/.test(e.name))
		.map((e) => {
			const key = keyById.get(e.id);
			return {
				id: e.id,
				name: e.name,
				type: e.type,
				aliases: e.aliases ?? [],
				description: e.description ?? "",
				mentions: counts.get(e.id) ?? 0,
				family: key?.family ?? familyOf(e.name),
				foreword: key?.foreword,
				key: !!key,
			};
		});
	const refs = keyConceptRefs();
	for (const c of concepts.filter((c) => c.id.startsWith("kc-"))) {
		out.push({
			id: c.id,
			name: c.en,
			type: "concept",
			aliases: [],
			description: "",
			mentions: refs.get(c.id)?.length ?? 0,
			family: c.family,
			foreword: c.foreword,
			key: true,
		});
	}
	entityCache = out;
	return out;
}

/**
 * One fixed translation for an English word that recurs inside many terms (staff, Master, actual).
 * `forms` holds every target-language form of the root (singular, plural, adjective).
 */
export type Root = {
	forms: string[];
	reason?: string;
	decision?: { by: string; date: string; note?: string };
};

export function rootsPath(lang: string): string {
	return join(ROOT, `data/translations/${lang}/roots.json`);
}

export function loadRoots(lang: string): Record<string, Root> {
	const path = rootsPath(lang);
	return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

/** Groups of terms that a reviewer accepted as sharing one form. */
export type Consistency = { same: string[][] };

export function consistencyPath(lang: string): string {
	return join(ROOT, `data/translations/${lang}/consistency.json`);
}

export function loadConsistency(lang: string): Consistency {
	const path = consistencyPath(lang);
	return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : { same: [] };
}

/** Folds case and accents, and drops the articles and "de", so near-identical names compare equal. */
export function foldName(s: string): string {
	return fold(s)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w && !["el", "la", "los", "las", "lo", "de", "del", "the", "of"].includes(w))
		.join(" ");
}

/** Terms whose English contains a root word but whose target forms use none of the root's forms. */
export function rootViolations(
	glossary: Record<string, GlossaryEntry>,
	roots: Record<string, Root>,
): { root: string; id: string; en: string; name: string }[] {
	const names = new Map(glossaryEntities().map((e) => [e.id, e.name]));
	const out: { root: string; id: string; en: string; name: string }[] = [];
	for (const [word, root] of Object.entries(roots)) {
		const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
		const stems = root.forms.map((f) => fold(f));
		for (const [id, g] of Object.entries(glossary)) {
			const en = names.get(id) ?? "";
			if (!re.test(en)) continue;
			const target = fold([g.name, ...(g.aliases ?? [])].join(" | "));
			if (!stems.some((st) => target.includes(st))) out.push({ root: word, id, en, name: g.name });
		}
	}
	return out;
}

export function loadGlossary(lang: string): Record<string, GlossaryEntry> {
	const path = glossaryPath(lang);
	return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

/** True when a check raised a doubt about the entry. */
export function isFlagged(g: GlossaryEntry): boolean {
	// An entry from before form ratings needs an agreeing second opinion and a matching back-check.
	const formOk = g.formConfidence
		? g.formConfidence === "high"
		: g.second?.agree === true && g.backcheck?.verdict === "match";
	return (
		g.confidence !== "high" ||
		!formOk ||
		(g.second !== undefined && !g.second.agree) ||
		g.backcheck?.verdict === "mismatch" ||
		!!g.note
	);
}

/** True when a flagged entry still needs a ruling: no human decision and no adjudication yet. */
export function needsRuling(g: GlossaryEntry): boolean {
	return !g.decision && !g.adjudicated && isFlagged(g);
}

let termIndex: { byEntity: Map<string, Term>; byRef: Map<string, string[]> } | null = null;

/**
 * Glossary terms keyed to the paragraphs that mention them. Reads only the clean glossary,
 * which was translated from the English. The older entity translations are not used here.
 */
export function loadTerms(lang: string): {
	byEntity: Map<string, Term>;
	byRef: Map<string, string[]>;
} {
	if (termIndex) return termIndex;
	const glossary = loadGlossary(lang);
	const byEntity = new Map<string, Term>();
	for (const e of glossaryEntities()) {
		const g = glossary[e.id];
		if (!g) continue;
		byEntity.set(e.id, {
			en: e.name,
			meaning: g.meaning,
			enForms: [e.name, ...e.aliases].filter(Boolean),
			target: g.name,
			aliases: (g.aliases ?? []).filter((a) => a && a !== g.name),
			type: e.type,
			required: true,
		});
	}
	const byRef = new Map(
		Object.entries(loadMentions()).map(([ref, list]) => [ref, list.map((m) => m.id)]),
	);
	for (const [id, refs] of keyConceptRefs()) {
		for (const ref of refs) byRef.set(ref, [...(byRef.get(ref) ?? []), id]);
	}
	termIndex = { byEntity, byRef };
	return termIndex;
}

/** Terms mentioned in the given paragraph refs. */
export function termsForRefs(lang: string, refs: string[]): Term[] {
	const { byEntity, byRef } = loadTerms(lang);
	const ids = new Set(refs.flatMap((r) => byRef.get(r) ?? []));
	return [...ids]
		.map((id) => byEntity.get(id))
		.filter((t): t is Term => !!t)
		.sort((a, b) => a.en.localeCompare(b.en));
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
