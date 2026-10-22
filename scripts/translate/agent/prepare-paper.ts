/**
 * prepare-paper.ts — Write a self-contained translation packet for one or more papers.
 *
 * Usage:
 *   bun scripts/translate/agent/prepare-paper.ts --lang=es --paper=1
 *   bun scripts/translate/agent/prepare-paper.ts --lang=es --papers=1,100,196 --candidate=gpt
 *
 * The packet holds the style guide, the glossary terms that the paper uses, the titles,
 * and the English paragraphs. Any model can work from it. It holds no existing translation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	draftPath,
	glossaryPath,
	LANG_NAMES,
	loadEnglishPaper,
	loadTermDecisions,
	pad,
	parseArgs,
	STYLE_GUIDE_DIR,
	termsForRefs,
	WORK_DIR,
} from "./lib.ts";

const { lang, papers, flags } = parseArgs();
const candidate = [...flags].find((a) => a.startsWith("--candidate="))?.split("=")[1] ?? "main";
const language = LANG_NAMES[lang]!;

const common = readFileSync(join(STYLE_GUIDE_DIR, "common.md"), "utf-8");
const guidePath = join(STYLE_GUIDE_DIR, `${lang}.md`);
if (!existsSync(guidePath)) {
	console.error(`No style guide at ${guidePath}. Write one before translating ${language}.`);
	process.exit(1);
}
const guide = readFileSync(guidePath, "utf-8");
const cleanRoom = readFileSync(join(import.meta.dir, "clean-room.md"), "utf-8");
const method = readFileSync(join(import.meta.dir, "meaning-first.md"), "utf-8");
const decisions = loadTermDecisions(lang);
if (!existsSync(glossaryPath(lang))) {
	console.error(`No clean glossary at ${glossaryPath(lang)}. Build it first (see README).`);
	process.exit(1);
}

for (const paper of papers) {
	const en = loadEnglishPaper(paper);
	const terms = termsForRefs(
		lang,
		en.paragraphs.map((p) => p.ref),
	);
	const table = terms.length
		? [
				`| English | ${language} | Short forms | Meaning |`,
				"|---|---|---|---|",
				...terms.map(
					(t) => `| ${t.en} | ${t.target} | ${t.aliases.join("; ")} | ${t.meaning ?? ""} |`,
				),
			].join("\n")
		: "(none)";

	const sections = en.sections.filter((s) => s.title);
	const draftExample = {
		paperTitle: "…",
		sectionTitles: Object.fromEntries(sections.slice(0, 2).map((s) => [s.id, "…"])),
		paragraphs: Object.fromEntries(
			en.paragraphs.slice(0, 2).map((p) => [p.ref, "<span …>…</span>"]),
		),
	};

	const packet = `# Translate Paper ${paper} into ${language}

You translate one paper of the Urantia Papers from English into ${language}. The English text is in the public domain. Your translation will be released as CC0.

${cleanRoom}

Output: write one JSON file to \`${draftPath(lang, paper, candidate)}\` with this shape:

\`\`\`json
${JSON.stringify(draftExample, null, 2)}
\`\`\`

- \`paragraphs\` has one key for each paragraph reference below (${en.paragraphs.length} in total). The value is the translated HTML.
- Keep every HTML tag and class exactly as in the English. Translate only the text between the tags.
- \`sectionTitles\` has one key for each section id below. Leave out sections with no title.

${method}

Use the method for each term or phrase that is not in the glossary and has a special sense in the papers, and for any sentence whose meaning you are not sure of. Record a new term in \`newTerms\`.

${common}

${guide}

## Glossary for this paper

Use these forms. You can change number and gender to fit the sentence.

${table}

Terms that earlier papers chose. Use the same forms when they appear.

${
	Object.keys(decisions).length
		? Object.entries(decisions)
				.map(([en, tr]) => `- ${en}: ${tr}`)
				.join("\n")
		: "(none yet)"
}

## Titles

- Paper title: ${en.title}
${sections.map((s) => `- Section ${s.id}: ${s.title}`).join("\n")}

## Paragraphs

${en.paragraphs.map((p) => `### ${p.ref}\n\n${p.htmlText}`).join("\n\n")}
`;

	const out = join(WORK_DIR, lang, candidate, `paper-${pad(paper)}.packet.md`);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, packet);
	console.log(`Paper ${paper}: ${en.paragraphs.length} paragraphs, ${terms.length} terms → ${out}`);
}
