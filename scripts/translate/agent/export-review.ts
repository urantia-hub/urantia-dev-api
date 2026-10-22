/**
 * export-review.ts — Write blind review packets that compare candidate translations.
 *
 * Usage:
 *   bun scripts/translate/agent/export-review.ts --lang=es --papers=1,100,196 \
 *     --candidates=claude-opus,claude-sonnet,gpt,gemini [--sample=30]
 *
 * Candidate names start with the model family ("claude-…", "gpt-…"), so the tally can
 * leave out a judge's own family. Labels are random per paper; the key stays in key.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { editionDirs, loadEdition } from "./checks.ts";
import {
	type Draft,
	draftPath,
	loadDraft,
	LANG_NAMES,
	loadEnglishPaper,
	pad,
	parseArgs,
	stripTags,
	WORK_DIR,
} from "./lib.ts";

const { lang, papers, flags } = parseArgs();
const arg = (name: string) => [...flags].find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
// --reference=book-es adds an existing edition as a blind candidate, for comparison only.
// The review packets stay in .work/ and are never committed or shown to a translator.
const references = (arg("reference") ?? "").split(",").filter(Boolean);
for (const r of references) {
	if (!editionDirs(lang).includes(r)) {
		console.error(`No edition "${r}". On disk: ${editionDirs(lang).join(", ") || "none"}`);
		process.exit(1);
	}
}
const candidates = [
	...(arg("candidates") ?? "").split(",").filter(Boolean),
	...references.map((r) => `reference-${r}`),
];
const sample = Number(arg("sample") ?? 30);
if (candidates.length < 2) {
	console.error("--candidates and --reference need two or more names in total");
	process.exit(1);
}

const dir = join(WORK_DIR, lang, "review");
mkdirSync(dir, { recursive: true });
const keyPath = join(dir, "key.json");
const key: Record<string, Record<string, string>> = existsSync(keyPath)
	? JSON.parse(readFileSync(keyPath, "utf-8"))
	: {};

function shuffle<T>(list: T[]): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

for (const paper of papers) {
	const drafts = candidates.map((c) => {
		if (c.startsWith("reference-")) {
			const edition = loadEdition(c.slice("reference-".length), paper);
			return { paragraphs: Object.fromEntries(edition ?? []) } as Draft;
		}
		const draft = loadDraft(lang, paper, c);
		if (!draft) throw new Error(`Missing draft for ${c}: ${draftPath(lang, paper, c)}`);
		return draft;
	});
	const en = loadEnglishPaper(paper);
	const shared = en.paragraphs.filter((p) => drafts.every((d) => d.paragraphs[p.ref]));
	const step = Math.max(1, shared.length / sample);
	const picked = Array.from(
		{ length: Math.min(sample, shared.length) },
		(_, i) => shared[Math.floor(i * step)]!,
	);

	const labels = "ABCDEFGH".slice(0, candidates.length).split("");
	const order = shuffle(candidates.map((_, i) => i));
	key[String(paper)] = Object.fromEntries(labels.map((l, i) => [l, candidates[order[i]!]!]));

	const body = picked
		.map((p) => {
			const versions = labels
				.map((l, i) => `**${l}:** ${stripTags(drafts[order[i]!]!.paragraphs[p.ref]!)}`)
				.join("\n\n");
			// Plain text for every version, so markup does not show which one is which.
			return `### ${p.ref}\n\n**English:** ${p.text}\n\n${versions}`;
		})
		.join("\n\n---\n\n");

	const packet = `# Blind review: Paper ${paper}, English to ${LANG_NAMES[lang]}

You are one judge on a panel. Each paragraph below has the English source and ${labels.length} ${LANG_NAMES[lang]} translations, labeled ${labels.join(", ")}. The labels do not say who made each one. Judge only the text.

For each paragraph:

1. Rank the translations from best to worst. Ties are not allowed.
2. Score each translation from 1 to 5 on four points:
   - **accuracy**: same meaning as the English. Nothing added, nothing left out. Check each clause.
   - **terms**: the coined names (beings, places, orders) are consistent and correct.
   - **register**: a dignified, clear, modern tone that suits a serious text. Not archaic, not casual.
   - **fluency**: reads as if a native writer wrote it.
3. Write one short note in English on the most important difference.

Translate a sentence back to English in your head when you suspect a change of meaning.

Write one JSON file to \`${join(dir, "judges", "<your-model-name>", `paper-${pad(paper)}.json`)}\`. Start the name with your model family, for example \`claude-opus\`, \`gpt-6\`, \`gemini-flash\`, or \`grok\`.

\`\`\`json
{
  "${picked[0]?.ref}": {
    "ranking": [${labels.map((l) => `"${l}"`).join(", ")}],
    "scores": { ${labels.map((l) => `"${l}": { "accuracy": 5, "terms": 5, "register": 5, "fluency": 5 }`).join(", ")} },
    "note": "…"
  }
}
\`\`\`

## Paragraphs (${picked.length})

${body}
`;
	writeFileSync(join(dir, `paper-${pad(paper)}.review.md`), packet);
	console.log(
		`Paper ${paper}: ${picked.length} paragraphs → ${join(dir, `paper-${pad(paper)}.review.md`)}`,
	);
}

writeFileSync(keyPath, `${JSON.stringify(key, null, "\t")}\n`);
console.log(`Key: ${keyPath} (do not show it to a judge)`);
