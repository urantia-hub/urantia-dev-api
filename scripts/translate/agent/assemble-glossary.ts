/**
 * assemble-glossary.ts — Check the glossary drafts and merge them into glossary.json.
 *
 * Usage: bun scripts/translate/agent/assemble-glossary.ts --lang=es [--dry-run]
 *
 * Reads every draft in .work/translate/<lang>/glossary/:
 *   batch-*   first translations
 *   second-*  independent second opinions; a different form marks the term for a human
 *   blind-*   blind readings of the forms (with blind-*.key.json)
 *   judge-*   verdicts that compare a blind reading with the meaning
 *   adjud-*   an agent's ruling on each flagged term
 * Moves each merged draft to done/. An entry with a human `decision` is never changed.
 * Exits 1 when a draft has an error.
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
	type Confidence,
	fold,
	type GlossaryEntry,
	glossaryEntities,
	glossaryPath,
	loadEnglishPaper,
	loadGlossary,
	loadRoots,
	needsRuling,
	PAPER_NUMBERS,
	parseArgs,
	rootViolations,
	WORK_DIR,
} from "./lib.ts";

const { lang, flags } = parseArgs();
const DRY_RUN = flags.has("--dry-run");
const dir = join(WORK_DIR, lang, "glossary");
const drafts = existsSync(dir)
	? readdirSync(dir)
			.filter((f) => f.endsWith(".draft.json"))
			.sort((a, b) => order(a) - order(b) || a.localeCompare(b))
	: [];

// Merge first translations before the checks that refer to them.
function order(file: string): number {
	return ["batch", "second", "blind", "judge", "adjud"].indexOf(file.split("-")[0]!);
}

const entities = new Map(glossaryEntities().map((e) => [e.id, e]));
const glossary = loadGlossary(lang);
const LEVELS = ["high", "medium", "low"];
let failed = 0;
let changed = 0;

type Raw = Record<string, Record<string, unknown>>;

// Translators write forced choices as strings or as { choice, reason } objects.
function forcedChoices(raw: unknown): string[] {
	if (!Array.isArray(raw)) return typeof raw === "string" && raw.trim() ? [raw.trim()] : [];
	return raw
		.map((c) =>
			typeof c === "string" ? c : [c?.choice, c?.reason].filter(Boolean).join(": "),
		)
		.filter((c) => c.trim());
}

for (const file of drafts) {
	const kind = file.split("-")[0]!;
	let draft: Raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
	if (kind === "blind") {
		const keyFile = join(dir, file.replace(".draft.json", ".key.json"));
		const key: Record<string, string> = JSON.parse(readFileSync(keyFile, "utf-8"));
		draft = Object.fromEntries(Object.entries(draft).map(([k, v]) => [key[k] ?? k, v]));
	}
	const errors: string[] = [];
	for (const [id, v] of Object.entries(draft)) {
		const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string).trim() : "");
		if (!entities.has(id)) errors.push(`${id}: not a glossary term`);
		else if (kind === "batch" || kind === "second") {
			if (!str("name")) errors.push(`${id}: no name`);
			if (!str("meaning")) errors.push(`${id}: no meaning`);
			if (!LEVELS.includes(str("confidence"))) errors.push(`${id}: bad confidence`);
			if (!LEVELS.includes(str("formConfidence"))) errors.push(`${id}: bad formConfidence`);
		} else if (kind === "blind" && !str("reading")) errors.push(`${id}: no reading`);
		else if (kind === "judge" && !["match", "mismatch"].includes(str("verdict"))) {
			errors.push(`${id}: verdict must be match or mismatch`);
		} else if (kind === "adjud" && (!str("name") || !str("reason"))) {
			errors.push(`${id}: a ruling needs a name and a reason`);
		}
		if (kind !== "batch" && !glossary[id]) errors.push(`${id}: no first translation yet`);
	}
	console.log(`${file}: ${Object.keys(draft).length} terms, ${errors.length} errors`);
	for (const m of errors.slice(0, 20)) console.log(`  error ${m}`);
	if (errors.length) {
		failed++;
		continue;
	}

	for (const [id, v] of Object.entries(draft)) {
		const g = glossary[id];
		if (g?.decision) continue;
		if (kind === "batch") {
			if (g) continue;
			const name = (v.name as string).trim();
			const aliases = ((v.aliases as string[]) ?? []).filter((a) => a?.trim() && a !== name);
			glossary[id] = {
				name,
				...(aliases.length ? { aliases } : {}),
				meaning: (v.meaning as string).trim(),
				confidence: v.confidence as Confidence,
				formConfidence: v.formConfidence as Confidence,
				...((v.rejected as unknown[])?.length ? { rejected: v.rejected as GlossaryEntry["rejected"] } : {}),
				...(typeof v.note === "string" && v.note.trim() ? { note: v.note.trim() } : {}),
				...(forcedChoices(v.forcedChoices).length ? { forcedChoices: forcedChoices(v.forcedChoices) } : {}),
			};
		} else if (kind === "second") {
			const name = (v.name as string).trim();
			const forms = [g!.name, ...(g!.aliases ?? [])].map(fold);
			g!.second = {
				name,
				meaning: (v.meaning as string).trim(),
				formConfidence: v.formConfidence as Confidence,
				agree: forms.includes(fold(name)),
			};
		} else if (kind === "blind") {
			g!.backcheck = {
				reading: (v.reading as string).trim(),
				...((v.misreadings as string[])?.length ? { misreadings: v.misreadings as string[] } : {}),
			};
		} else if (kind === "adjud") {
			const name = (v.name as string).trim();
			const prior = g!.adjudicated;
			const contested =
				!v.tiebreak && prior && name !== g!.name
					? { name: g!.name, reason: prior.reason, ...(prior.previous ? { previous: prior.previous } : {}) }
					: undefined;
			const aliases = Array.isArray(v.aliases)
				? (v.aliases as string[]).filter((a) => a?.trim() && a !== name)
				: g!.aliases;
			glossary[id] = {
				...g!,
				name,
				...(aliases?.length ? { aliases } : { aliases: undefined }),
				adjudicated: {
					date: new Date().toISOString().slice(0, 10),
					reason: (v.reason as string).trim(),
					...(name !== g!.name ? { previous: g!.name } : {}),
					...(contested ? { contested } : {}),
					...(v.tiebreak ? { tiebreak: true } : {}),
					...(typeof v.rootIssue === "string" && v.rootIssue.trim() ? { rootIssue: v.rootIssue.trim() } : {}),
				},
			};
		} else if (kind === "judge") {
			g!.backcheck = {
				...g!.backcheck!,
				verdict: v.verdict as "match" | "mismatch",
				...(v.note ? { note: v.note as string } : {}),
			};
		}
		changed++;
	}
	if (!DRY_RUN) {
		mkdirSync(join(dir, "done"), { recursive: true });
		renameSync(join(dir, file), join(dir, "done", file));
		const keyFile = join(dir, file.replace(".draft.json", ".key.json"));
		if (existsSync(keyFile)) renameSync(keyFile, join(dir, "done", file.replace(".draft.json", ".key.json")));
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

// Every reference that a meaning cites must exist in the English text.
const refs = new Set(PAPER_NUMBERS.flatMap((n) => loadEnglishPaper(n).paragraphs.map((p) => p.ref)));
// "194:4.0" names a section, so it exists when the section has a paragraph.
for (const r of [...refs]) refs.add(r.replace(/\.\d+$/, ".0"));
const badRefs = Object.entries(glossary).flatMap(([id, g]) =>
	[...`${g.meaning ?? ""} ${g.second?.meaning ?? ""}`.matchAll(/\b(\d{1,3}:\d{1,2}\.\d{1,3})\b/g)]
		.map((m) => m[1]!)
		.filter((r) => !refs.has(r))
		.map((r) => `${id}: ${r}`),
);
if (badRefs.length) {
	console.log(`\nReferences that do not exist (${badRefs.length}):`);
	for (const r of badRefs.slice(0, 40)) console.log(`  ${r}`);
}

const broken = rootViolations(glossary, loadRoots(lang));
if (broken.length) {
	console.log(`\nTerms that do not use a fixed root (${broken.length}; fix with decide-glossary.ts or requeue):`);
	for (const v of broken.slice(0, 40)) console.log(`  ${v.root}: ${v.en} → ${v.name}`);
}

const pending = Object.entries(glossary).filter(([, g]) => needsRuling(g));
const count = (f: (g: GlossaryEntry) => boolean) => Object.values(glossary).filter(f).length;
console.log(`
${Object.keys(glossary).length}/${entities.size} terms (${changed} changes this run)
  second opinions: ${count((g) => !!g.second)} (${count((g) => g.second?.agree === false)} disagree)
  blind readings: ${count((g) => !!g.backcheck)}, judged: ${count((g) => !!g.backcheck?.verdict)} (${count((g) => g.backcheck?.verdict === "mismatch")} mismatch)
  human decisions: ${count((g) => !!g.decision)}
  adjudicated: ${count((g) => !!g.adjudicated)}
  flagged, no ruling yet: ${pending.length} (bun scripts/translate/agent/prepare-adjudication.ts --lang=${lang})`);

if (!DRY_RUN && changed) {
	const sorted = Object.fromEntries(Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(glossaryPath(lang), `${JSON.stringify(sorted, null, "\t")}\n`);
	console.log(`Wrote ${glossaryPath(lang)}`);
}
process.exit(failed ? 1 : 0);
