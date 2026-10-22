/**
 * check-consistency.ts — Find conflicts between related glossary terms, and write a packet for a reviewer.
 *
 * Usage: bun scripts/translate/agent/check-consistency.ts --lang=es
 *
 * Finds two kinds of conflict that a per-term review cannot see:
 *   shared forms  two different terms with one target form (articles and accents ignored)
 *   root splits   an English word inside many terms that gets two or more target roots
 * Writes .work/translate/<lang>/consistency.md (the findings) and consistency.packet.md (for a
 * fresh agent that sorts them and proposes one root for each split). Merge its draft with
 * assemble-consistency.ts.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	fold,
	foldName,
	glossaryEntities,
	LANG_NAMES,
	loadConsistency,
	loadGlossary,
	loadRoots,
	parseArgs,
	rootViolations,
	WORK_DIR,
} from "./lib.ts";

// English words too common to be a root.
const STOP = new Set(
	"the of and in on at to a an for from by with on' s on-the order corps sons son spirit spirits god"
		.split(" ")
		.concat(["mother", "father"]),
);
const MIN_TERMS = 3;
const MIN_COVERAGE = 0.85;

const { lang } = parseArgs();
const language = LANG_NAMES[lang]!;
const glossary = loadGlossary(lang);
const roots = loadRoots(lang);
const reviewed = loadConsistency(lang);
const entities = new Map(glossaryEntities().map((e) => [e.id, e]));
const en = (id: string) => entities.get(id)?.name ?? id;
// "Amos (Prophet)" and "Amos (brother of Jesus)" share "Amos" in English too.
const enBase = (id: string) => foldName(en(id).replace(/\s*\(.*?\)\s*/g, " ").replace(/,.*$/, ""));
const done = Object.keys(glossary).filter((id) => entities.has(id));

// 1. Shared forms.
const byForm = new Map<string, Set<string>>();
for (const id of done) {
	const g = glossary[id]!;
	for (const f of [g.name, ...(g.aliases ?? [])]) {
		const k = foldName(f);
		if (k) byForm.set(k, new Set([...(byForm.get(k) ?? []), id]));
	}
}
const sameKey = (ids: string[]) => [...ids].sort().join(" ");
const accepted = new Set(reviewed.same.map(sameKey));
const shared = [...byForm.entries()]
	.map(([form, ids]) => ({ form, ids: [...ids].sort() }))
	.filter(({ ids }) => ids.length > 1)
	// The English shares the name too, or a reviewer already accepted the group.
	.filter(({ ids }) => new Set(ids.map(enBase)).size > 1 && !accepted.has(sameKey(ids)));

// 2. Root splits: for each recurring English word, the target stems used in its terms.
const stems = (s: string) =>
	new Set(
		foldName(s)
			.split(" ")
			.filter((w) => w.length >= 3)
			.map((w) => w.slice(0, 5)),
	);
const termStems = new Map(
	done.map((id) => {
		const g = glossary[id]!;
		return [id, stems([g.name, ...(g.aliases ?? [])].join(" "))] as const;
	}),
);
const globalCount = new Map<string, number>();
for (const set of termStems.values()) for (const st of set) globalCount.set(st, (globalCount.get(st) ?? 0) + 1);

// "actuals" and "actual" are one word.
const enWords = (id: string) =>
	new Set(
		fold(en(id))
			.split(/[^\p{L}-]+/u)
			.map((w) => w.replace(/ies$/, "y").replace(/(?<!s)s$/, ""))
			.filter((w) => w.length >= 3),
	);
const byWord = new Map<string, string[]>();
for (const id of done) for (const w of enWords(id)) byWord.set(w, [...(byWord.get(w) ?? []), id]);

// Each target stem belongs to the English word it goes with most strongly: the word whose terms
// nearly all have the stem, and whose stem is found nearly only in its terms. So in "Prince's staff"
// the stem "princ" belongs to "prince", and "staff" must have a stem of its own.
const pair = new Map<string, number>();
for (const id of done) {
	for (const w of enWords(id)) for (const st of termStems.get(id)!) pair.set(`${w}\t${st}`, (pair.get(`${w}\t${st}`) ?? 0) + 1);
}
const owner = new Map<string, { word: string; score: number }>();
for (const [k, c] of pair) {
	const [w, st] = k.split("\t") as [string, string];
	const score = (c / byWord.get(w)!.length) * (c / globalCount.get(st)!);
	if (score > (owner.get(st)?.score ?? 0)) owner.set(st, { word: w, score });
}

// A stem counts for a word when its owner is the word or a word of its family (infinite, infinity),
// or when the stem keeps the English spelling (Jerusem).
const belongsTo = (st: string, word: string) => {
	const head = (w: string) => w.replace(/-/g, "").slice(0, 4);
	return head(owner.get(st)?.word ?? "") === head(word) || head(st) === head(word);
};

type Split = { word: string; terms: number; root: string; coverage: number; others: { id: string; name: string }[] };
const splits: Split[] = [];
for (const [word, ids] of byWord) {
	if (ids.length < MIN_TERMS || STOP.has(word) || roots[word]) continue;
	const counts = new Map<string, number>();
	for (const id of ids) {
		for (const st of termStems.get(id)!) if (belongsTo(st, word)) counts.set(st, (counts.get(st) ?? 0) + 1);
	}
	const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	const coverage = best ? best[1] / ids.length : 0;
	if (coverage >= MIN_COVERAGE) continue;
	splits.push({
		word,
		terms: ids.length,
		root: best?.[0] ?? "(none)",
		coverage,
		others: ids.filter((id) => !best || !termStems.get(id)!.has(best[0])).map((id) => ({ id, name: glossary[id]!.name })),
	});
}
splits.sort((a, b) => b.terms - a.terms);

// 3. Terms that break a decided or proposed root.
const violations = rootViolations(glossary, roots);

const findings = `# ${language} glossary consistency

${done.length} terms. ${shared.length} shared forms, ${splits.length} possible root splits, ${violations.length} terms that break a root in roots.json.

## Shared forms (${shared.length})

Two different terms that have the same ${language} form. The English names differ, so check that they name the same thing.

${shared.map(({ form, ids }) => `- **${form}**: ${ids.map((id) => `${en(id)} → ${glossary[id]!.name} (\`${id}\`)`).join("; ")}`).join("\n")}

## Possible root splits (${splits.length})

An English word in ${MIN_TERMS} or more terms, where fewer than ${Math.round(MIN_COVERAGE * 100)}% of its terms share one ${language} stem. Some are not real splits (a name, or a word with two senses).

${splits.map((s) => `- **${s.word}** (${s.terms} terms; "${s.root}…" in ${Math.round(s.coverage * 100)}%). Others: ${s.others.map((o) => `${en(o.id)} → ${o.name}`).join("; ")}`).join("\n")}

## Terms that break a root (${violations.length})

${violations.map((v) => `- ${v.root}: ${v.en} → ${v.name} (\`${v.id}\`)`).join("\n")}
`;

const dir = join(WORK_DIR, lang);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "consistency.md"), findings);

const cleanRoom = readFileSync(join(import.meta.dir, "clean-room.md"), "utf-8");
const draft = join(dir, "consistency.draft.json");
const packet = `# Review the ${language} glossary for consistency

The glossary below was translated in parallel batches, so related terms can disagree. Your job is to find those conflicts and propose one fix for each. You do not translate new terms.

${cleanRoom}

You can use the urantia.dev MCP tools (English only, never a \`lang\` value) to check what a term refers to.

## What to do

1. **Shared forms.** For each group in "Shared forms" in the findings below, decide:
   - \`same\`: the terms name the same thing (for example, a full name and its short form), or they name different things that the English also names the same way. The shared form is correct.
   - \`conflict\`: different things, and a reader cannot tell them apart. Propose a new form for one or more of the terms.
2. **Root splits.** For each English word in "Possible root splits", decide if it is a real split: one English sense with two or more ${language} roots. If it is, propose one root and list its forms (singular, plural, adjective). Choose with the method: find the sense in the papers, test each candidate for a wrong reading, and prefer the root that most terms already use when it is as good. If the word has two senses in the papers, say so; that is not a split.
3. **Others.** Add any other conflict that you see in the full list: two names that differ by too little (only an article or a letter), or a family where one term breaks the pattern.

Rules:
- Terms marked [decided] are a human's decision. Do not propose a change to them. If one of them causes a conflict, report the conflict and propose a change to the other term, or explain why no change works.
- Keep each reason to one or two sentences.

## Output

Write one JSON file to \`${draft}\`:

\`\`\`json
{
  "same": [["id-a", "id-b"]],
  "conflicts": [{ "ids": ["id-a", "id-b"], "problem": "…", "fix": { "id-b": "new form" } }],
  "roots": { "staff": { "forms": ["personal"], "reason": "…", "terms": ["id-1", "id-2"] } },
  "notSplits": { "word": "why it is not a split" }
}
\`\`\`

In \`roots\`, \`terms\` lists the terms whose form must change to use the root.

## Findings

${findings.replace(/^# .*\n/, "")}

## Roots already set

${Object.entries(roots).map(([w, r]) => `- ${w}: ${r.forms.join(", ")}${r.decision ? " [decided]" : ""}`).join("\n") || "(none)"}

## The full glossary (${done.length})

English → ${language}, with the id.

${done
	.sort((a, b) => en(a).localeCompare(en(b)))
	.map((id) => {
		const g = glossary[id]!;
		return `- ${en(id)} → ${g.name}${g.aliases?.length ? ` (${g.aliases.join("; ")})` : ""}${g.decision ? " [decided]" : ""} \`${id}\``;
	})
	.join("\n")}
`;
writeFileSync(join(dir, "consistency.packet.md"), packet);
console.log(
	`${shared.length} shared forms, ${splits.length} possible root splits, ${violations.length} root violations\n→ ${join(dir, "consistency.md")}\n→ ${join(dir, "consistency.packet.md")}`,
);
