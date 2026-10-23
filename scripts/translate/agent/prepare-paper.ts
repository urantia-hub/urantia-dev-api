/**
 * prepare-paper.ts — Write a self-contained translation packet for one or more papers.
 *
 * Usage:
 *   bun scripts/translate/agent/prepare-paper.ts --lang=es --paper=1
 *   bun scripts/translate/agent/prepare-paper.ts --lang=es --papers=1,100,196 --candidate=gpt
 *
 * The packet holds the style guide, the glossary terms that the paper uses, the titles,
 * and the English paragraphs. Any model can work from it. It holds no existing translation.
 *
 * --redo writes a packet with only the paragraphs of the draft that fail the copy check, for a fresh
 * agent. It shows the English only, never the failed wording. assemble-paper.ts merges the answer.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COPY_LIMIT_PARAGRAPH, copyScore } from "./checks.ts";
import {
	type Draft,
	draftPath,
	glossaryPath,
	LANG_NAMES,
	loadDraft,
	loadEnglishPaper,
	loadTermDecisions,
	pad,
	parseArgs,
	redoPath,
	STYLE_GUIDE_DIR,
	stripTags,
	termsInText,
	WORK_DIR,
} from "./lib.ts";

const { lang, papers, flags } = parseArgs();
const candidate = [...flags].find((a) => a.startsWith("--candidate="))?.split("=")[1] ?? "main";
const language = LANG_NAMES[lang]!;
const REDO = flags.has("--redo");

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
	let paragraphs = en.paragraphs;
	if (REDO) {
		// The next round writes the same redo file, so fold the last round into the draft first.
		const last = redoPath(lang, paper, candidate);
		const draft = loadDraft(lang, paper, candidate)!;
		if (existsSync(last)) {
			writeFileSync(draftPath(lang, paper, candidate), `${JSON.stringify(draft, null, 2)}\n`);
			renameSync(last, last.replace(/\.json$/, `-${Date.now().toString(36)}.json`));
		}
		paragraphs = paragraphs.filter((p) => {
			const html = draft.paragraphs?.[p.ref];
			return html && copyScore(lang, paper, p.ref, stripTags(html)) > COPY_LIMIT_PARAGRAPH;
		});
		if (!paragraphs.length) {
			console.log(`Paper ${paper}: no paragraph fails the copy check`);
			continue;
		}
	}
	const terms = termsInText(lang, [en.title, ...paragraphs.map((p) => p.text)].join("\n"));
	const table = terms.length
		? [
				`| English | ${language} | Short forms | Meaning |`,
				"|---|---|---|---|",
				...terms.map(
					(t) => `| ${t.en} | ${t.target} | ${t.aliases.join("; ")} | ${t.meaning ?? ""} |`,
				),
			].join("\n")
		: "(none)";

	const sections = REDO ? [] : en.sections.filter((s) => s.title);
	const example = Object.fromEntries(
		paragraphs.slice(0, 2).map((p) => [p.ref, "<span …>…</span>"]),
	);
	const draftExample = REDO
		? { paragraphs: example }
		: {
				paperTitle: "…",
				sectionTitles: Object.fromEntries(sections.slice(0, 2).map((s) => [s.id, "…"])),
				paragraphs: example,
			};
	const output = REDO ? redoPath(lang, paper, candidate) : draftPath(lang, paper, candidate);
	const redoNote = REDO
		? `\n## Why these paragraphs\n\nA check compared an earlier translation of these paragraphs with the published translations of this book, and too much of its wording matched. Translate each paragraph again from the English. Build each sentence yourself: choose the word order and the words that read naturally in ${language}, and do not use a wording that you remember. Keep the meaning exact.\n`
		: "";

	const packet = `# Translate Paper ${paper} into ${language}

You translate one paper of the Urantia Papers from English into ${language}. The English text is in the public domain. Your translation will be released as CC0.

${cleanRoom}

${redoNote}
Output: write one JSON file to \`${output}\` with this shape:

\`\`\`json
${JSON.stringify(draftExample, null, 2)}
\`\`\`

- \`paragraphs\` has one key for each paragraph reference below (${paragraphs.length} in total). The value is the translated HTML.
- Keep every HTML tag and class exactly as in the English. Translate only the text between the tags.
${REDO ? "" : "- `sectionTitles` has one key for each section id below. Leave out sections with no title."}

${method}

Use the method for each term or phrase that is not in the glossary and has a special sense in the papers, and for any sentence whose meaning you are not sure of. Record a new term in \`newTerms\`, and each forced choice in \`forcedChoices\`: \`[{ "ref": "1:0.1", "choice": "…", "reason": "…" }]\`.

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

${
	REDO
		? ""
		: `## Titles

- Paper title: ${en.title}
${sections.map((s) => `- Section ${s.id}: ${s.title}`).join("\n")}
`
}
## Paragraphs

${paragraphs.map((p) => `### ${p.ref}\n\n${p.htmlText}`).join("\n\n")}
`;

	const out = join(
		WORK_DIR,
		lang,
		candidate,
		`paper-${pad(paper)}${REDO ? ".redo" : ""}.packet.md`,
	);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, packet);
	console.log(`Paper ${paper}: ${paragraphs.length} paragraphs, ${terms.length} terms → ${out}`);
}
