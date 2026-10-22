/**
 * review-glossary.ts — Write every flagged glossary term with all the evidence and its ruling.
 *
 * Usage: bun scripts/translate/agent/review-glossary.ts --lang=es [--all]
 *
 * Writes .work/translate/<lang>/glossary-review.md. --all includes every term, not only the
 * flagged ones. Record a decision with decide-glossary.ts.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glossaryEntities, isFlagged, LANG_NAMES, loadGlossary, parseArgs, WORK_DIR } from "./lib.ts";

const { lang, flags } = parseArgs();
const ALL = flags.has("--all");
const glossary = loadGlossary(lang);
const entities = glossaryEntities().sort((a, b) => b.mentions - a.mentions);

const rows = entities
	.filter((e) => glossary[e.id] && (ALL || isFlagged(glossary[e.id]!)))
	.map((e) => {
		const g = glossary[e.id]!;
		const why = [
			g.confidence !== "high" && `meaning confidence ${g.confidence}`,
			g.formConfidence !== "high" && `form confidence ${g.formConfidence}`,
			g.second && !g.second.agree && `second translator chose "${g.second.name}"`,
			g.backcheck?.verdict === "mismatch" && "blind reading does not match",
			g.note && "translator left a note",
		].filter(Boolean);
		return [
			`## ${e.name} → ${g.name}`,
			"",
			`- id: \`${e.id}\` · used in ${e.mentions} paragraphs${why.length ? ` · **${why.join("; ")}**` : ""}`,
			`- Meaning: ${g.meaning}`,
			g.aliases?.length ? `- Other forms: ${g.aliases.join("; ")}` : "",
			...(g.rejected ?? []).map((r) => `- Rejected "${r.form}": ${r.reason}`),
			g.note ? `- Translator's note: ${g.note}` : "",
			...(g.forcedChoices ?? []).map((c) => `- Forced choice: ${c}`),
			g.second ? `- Second translator: "${g.second.name}". Its meaning: ${g.second.meaning}` : "",
			g.backcheck ? `- Blind reader understood: ${g.backcheck.reading}` : "",
			g.backcheck?.misreadings?.length ? `- Possible misreadings: ${g.backcheck.misreadings.join("; ")}` : "",
			g.backcheck?.verdict ? `- Judge: ${g.backcheck.verdict}${g.backcheck.note ? `, ${g.backcheck.note}` : ""}` : "",
			g.adjudicated
				? `- Ruling (agent, ${g.adjudicated.date})${g.adjudicated.previous ? `, was "${g.adjudicated.previous}"` : ""}: ${g.adjudicated.reason}`
				: "",
			g.decision ? `- Decided by ${g.decision.by} on ${g.decision.date}${g.decision.note ? `: ${g.decision.note}` : ""}` : "",
		]
			.filter(Boolean)
			.join("\n");
	});

const out = join(WORK_DIR, lang, "glossary-review.md");
mkdirSync(join(WORK_DIR, lang), { recursive: true });
writeFileSync(
	out,
	`# ${LANG_NAMES[lang]} glossary: ${ALL ? "all terms" : "flagged terms"} (${rows.length})\n\nMost-used terms first.\n\n${rows.join("\n\n")}\n`,
);
console.log(`${rows.length} terms → ${out}`);
