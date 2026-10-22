/**
 * prepare-adjudication.ts — Write packets for an agent to rule on each flagged glossary term.
 *
 * Usage: bun scripts/translate/agent/prepare-adjudication.ts --lang=es [--force] [--blind]
 *
 * A term is flagged when a check raised a doubt (low confidence, a second translator disagreed,
 * the blind reading did not match, or the translator left a note). The adjudicator sees all the
 * evidence and chooses one form. It runs after the second opinions and the back-check, so a term
 * without them waits; --force includes it anyway. Merge with assemble-glossary.ts.
 *
 * --blind rules again on each term with a real dispute (a mismatch, a second translator that
 * differs, or low confidence), already ruled or not. The candidate forms come in a shuffled order
 * with no sign of the current one, because an adjudicator that knows the current form keeps it.
 *
 * --tiebreak gives a third adjudicator each term where two rulings chose different forms. It sees
 * both rulings with their reasons, in a shuffled order, and its ruling is final.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type GlossaryEntry,
	glossaryEntities,
	LANG_NAMES,
	loadGlossary,
	loadRoots,
	needsRuling,
	parseArgs,
	STYLE_GUIDE_DIR,
	WORK_DIR,
} from "./lib.ts";

const BATCH_SIZE = 40;

const { lang, flags } = parseArgs();
const FORCE = flags.has("--force");
const TIEBREAK = flags.has("--tiebreak");
const BLIND = flags.has("--blind") || TIEBREAK;
const language = LANG_NAMES[lang]!;
const dir = join(WORK_DIR, lang, "glossary");
const glossary = loadGlossary(lang);
const roots = loadRoots(lang);
const entities = glossaryEntities();
const byId = new Map(entities.map((e) => [e.id, e]));

const disputed = (g: GlossaryEntry) =>
	!g.decision &&
	(g.backcheck?.verdict === "mismatch" ||
		(!!g.second && !g.second.agree) ||
		g.confidence === "low" ||
		g.formConfidence === "low");

// --ids=<file> limits a round to the ids in the file, one per line: new terms after an earlier round.
const idsArg = [...flags].find((a) => a.startsWith("--ids="))?.split("=")[1];
const only = idsArg ? new Set(readFileSync(idsArg, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean)) : null;

const flagged = Object.entries(glossary).filter(
	([id, g]) =>
		(!only || only.has(id)) &&
		(TIEBREAK ? !!g.adjudicated?.contested : BLIND ? disputed(g) : needsRuling(g)),
);
const ready = flagged.filter(([id, g]) => {
	if (FORCE || BLIND) return true;
	const wantsSecond = byId.get(id)?.key || g.confidence !== "high" || g.formConfidence !== "high";
	return !!g.backcheck?.verdict && (!wantsSecond || !!g.second);
});

mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir).filter((f) => f.startsWith("adjud") && f.endsWith(".packet.md"))) {
	rmSync(join(dir, f));
}

/** A stable shuffle, so a rerun gives the same order and the order says nothing about the forms. */
function shuffle<T>(items: T[], seed: string): T[] {
	let h = 2166136261;
	for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		const j = (h >>> 0) % (i + 1);
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

function evidence(id: string, g: GlossaryEntry): string[] {
	const e = byId.get(id);
	return [
		`### ${id}`,
		"",
		`- English: ${e?.name} (${e?.type}${e?.key ? ", key concept" : ""}; used in ${e?.mentions} paragraphs)`,
		`- Meaning: ${g.meaning} (confidence ${g.confidence})`,
		`- First form: ${g.name}${g.aliases?.length ? ` (also: ${g.aliases.join("; ")})` : ""} (form confidence ${g.formConfidence ?? "not rated"})`,
		...(g.rejected ?? []).map((r) => `- Rejected "${r.form}": ${r.reason}`),
		g.second ? `- Second translator: ${g.second.name} (${g.second.agree ? "agrees" : "differs"}). Its meaning: ${g.second.meaning}` : "",
		g.backcheck ? `- Blind reader understood: ${g.backcheck.reading}` : "",
		g.backcheck?.misreadings?.length ? `- Possible misreadings: ${g.backcheck.misreadings.join("; ")}` : "",
		g.backcheck?.verdict ? `- Judge: ${g.backcheck.verdict}${g.backcheck.note ? `, ${g.backcheck.note}` : ""}` : "",
		g.note ? `- Translator's note: ${g.note}` : "",
		...(g.forcedChoices ?? []).map((c) => `- Forced choice: ${c}`),
	];
}

/** The same evidence with each form as an equal candidate. The blind reading goes with the form it read. */
const bare = (t: string) => t.trim().replace(/[.\s]+$/, "");

function blindEvidence(id: string, g: GlossaryEntry): string[] {
	const e = byId.get(id);
	const contested = g.adjudicated?.contested;
	const read = contested ? (contested.previous ?? contested.name) : (g.adjudicated?.previous ?? g.name);
	const forms = contested
		? [g.name, contested.name]
		: [...new Set([g.name, g.adjudicated?.previous, g.second?.name].filter((f): f is string => !!f))];
	const reasons = new Map(contested ? [[g.name, g.adjudicated!.reason], [contested.name, contested.reason]] : []);
	const meanings = [...new Set([g.meaning, g.second?.meaning].filter(Boolean))];
	return [
		`### ${id}`,
		"",
		`- English: ${e?.name} (${e?.type}${e?.key ? ", key concept" : ""}; used in ${e?.mentions} paragraphs)`,
		...meanings.map((m) => `- A translator's statement of the meaning: ${m}`),
		...(contested && g.backcheck && !forms.includes(read)
			? [`- A blind reader who saw the form "${read}" understood: ${bare(g.backcheck.reading)}.${g.backcheck.verdict === "mismatch" ? " A judge found that this reading does not match the meaning." : ""}`]
			: []),
		...shuffle(forms, id).map((f, i) => {
			const label = String.fromCharCode(65 + i);
			const reading =
				f === read && g.backcheck
					? ` A blind reader who saw only this form understood: ${bare(g.backcheck.reading)}.${g.backcheck.misreadings?.length ? ` Possible misreadings: ${g.backcheck.misreadings.map(bare).join("; ")}.` : ""}${g.backcheck.verdict === "mismatch" ? ` A judge found that this reading does not match the meaning${g.backcheck.note ? `: ${bare(g.backcheck.note)}` : ""}.` : ""}`
					: "";
			const ruling = reasons.has(f) ? ` An adjudicator chose it: ${bare(reasons.get(f)!)}.` : "";
			return `- Candidate ${label}: ${f}.${reading}${ruling}`;
		}),
	];
}

const cleanRoom = readFileSync(join(import.meta.dir, "clean-room.md"), "utf-8");
const method = readFileSync(join(import.meta.dir, "meaning-first.md"), "utf-8");
const guidePath = join(STYLE_GUIDE_DIR, `${lang}.md`);
const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf-8") : "";
const others = Object.entries(glossary)
	.filter(([id]) => !BLIND || !flagged.some(([f]) => f === id))
	.map(([id, g]) => `- ${byId.get(id)?.name ?? id}: ${g.name}`)
	.join("\n");

const steps = TIEBREAK
	? `## What to do for each term

Two adjudicators ruled on each term below on their own, and they chose different forms. Each candidate shows the reason its adjudicator gave. The order is random, and neither is the current form.

1. Find the meaning in the papers with the urantia.dev MCP tools (English only). Do this for every term.
2. Weigh the two reasons against the papers and against how a ${language} reader reads each form. A reason can be wrong.
3. Choose one candidate, or write a new form when both have a real problem.
4. Check that your form follows the fixed roots, and that no term in the full list uses it for a different thing. When the best form needs a different root, follow the root and describe the problem in \`rootIssue\`.
5. Write one or two sentences of reason. Name the evidence that decided it. Your ruling is final.`
	: BLIND
	? `## What to do for each term

1. Find the meaning in the papers with the urantia.dev MCP tools (English only). Do this for every term: the statements of the meaning below are a translator's summary, not the source.
2. Test each candidate as a reader who sees only that form: what does a ${language} reader understand? The candidates are in a random order. None of them is the current form, and none has a preference.
3. Choose the candidate that carries the meaning best and that a reader is least likely to misread. When every candidate has a real problem, write a new form.
4. Check that your form follows the fixed roots, and that no term in the full list uses it for a different thing. When the best form needs a different root, follow the root and describe the problem in \`rootIssue\`.
5. Write one or two sentences of reason. Name the evidence that decided it.`
	: `## What to do for each term

1. Read the evidence: the meaning, the first form, the rejected forms, the second translator's form, the blind reading, the judge's verdict, and the notes.
2. If you need more, check the meaning in the papers with the urantia.dev MCP tools (English only).
3. Choose one form. It can be the first form, the second translator's form, or a new form when both have a real problem.
4. Check that your form follows the fixed roots, and that no other term in the full list uses it for a different thing.
5. Write one or two sentences of reason. Name the evidence that decided it.

Keep the first form when the doubt is small and no candidate is clearly better. A change has a cost: translators and readers learn one form.`;

for (let i = 0; i < ready.length; i += BATCH_SIZE) {
	const batch = ready.slice(i, i + BATCH_SIZE);
	const stamp = `${Date.now().toString(36)}-${String(i / BATCH_SIZE).padStart(2, "0")}`;
	const draft = join(dir, `adjud-${stamp}.draft.json`);
	const packet = `# Rule on ${TIEBREAK ? "contested" : BLIND ? "disputed" : "flagged"} ${language} glossary terms

Each term below has a doubt that a check raised. No human reviews these terms before they are published, so your ruling is the final choice until a reader reports a problem. Choose the form that is most truthful to what the authors meant, and that a ${language} reader is least likely to misread.

${cleanRoom}

${method}

${steps}

${guide}

## Output

Write one JSON file to \`${draft}\`: \`{ "<id>": { "name": "…", "aliases": ["…"], "reason": "…"${BLIND ? ', "rootIssue": "…"' : ""}${TIEBREAK ? ', "tiebreak": true' : ""} } }\`.${TIEBREAK ? " Set `tiebreak` to true on every term." : ""} Give \`aliases\` only when they change${BLIND ? ", and `rootIssue` only when a root blocks the best form" : ""}. Include every term below (${batch.length}).

## Fixed roots

${Object.entries(roots).map(([w, r]) => `- ${w}: ${r.forms.join(", ")}`).join("\n") || "(none)"}

## Terms to rule on

${batch.map(([id, g]) => (BLIND ? blindEvidence(id, g) : evidence(id, g)).filter(Boolean).join("\n")).join("\n\n")}

## The full glossary, for collisions${BLIND ? "\n\nThe terms under dispute are not in this list." : ""}

${others}
`;
	writeFileSync(join(dir, `adjud-${stamp}.packet.md`), packet);
	console.log(`adjud batch: ${batch.length} terms → ${join(dir, `adjud-${stamp}.packet.md`)}`);
}
console.log(
	TIEBREAK
		? `${ready.length} contested terms, third ruling`
		: BLIND
		? `${ready.length} disputed terms, blind`
		: `${flagged.length} flagged without a ruling; ${ready.length} ready${FORCE ? " (forced)" : ""}`,
);
