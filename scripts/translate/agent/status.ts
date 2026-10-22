/**
 * status.ts — Progress for one language: papers done, paragraphs, confidence, and the next papers.
 *
 * Usage: bun scripts/translate/agent/status.ts --lang=es [--next=5]
 */

import { existsSync, readFileSync } from "node:fs";
import { copyScore } from "./checks.ts";
import {
	draftPath,
	loadEnglishPaper,
	outputPath,
	PAPER_NUMBERS,
	type ParagraphTranslation,
	parseArgs,
} from "./lib.ts";

const { lang, flags } = parseArgs();
const next = Number([...flags].find((a) => a.startsWith("--next="))?.split("=")[1] ?? 5);

let done = 0;
let paragraphs = 0;
let total = 0;
const confidence: Record<string, number> = {};
const todo: number[] = [];
const drafted: number[] = [];
const copied: string[] = [];

for (const paper of PAPER_NUMBERS) {
	const count = loadEnglishPaper(paper).paragraphs.length;
	total += count;
	if (!existsSync(outputPath(lang, paper))) {
		(existsSync(draftPath(lang, paper)) ? drafted : todo).push(paper);
		continue;
	}
	const rows: ParagraphTranslation[] = JSON.parse(readFileSync(outputPath(lang, paper), "utf-8"));
	const filled = rows.filter((r) => r.text);
	if (filled.length === count) done++;
	else todo.push(paper);
	paragraphs += filled.length;
	for (const r of filled) confidence[r.confidence] = (confidence[r.confidence] ?? 0) + 1;
	const matches = filled.filter((r) => copyScore(lang, paper, r.standardReferenceId, r.text) > 0.6);
	if (matches.length > filled.length / 4)
		copied.push(`${paper} (${matches.length}/${filled.length})`);
}

console.log(`${lang}: ${done}/197 papers complete, ${paragraphs}/${total} paragraphs`);
console.log(`  confidence: ${JSON.stringify(confidence)}`);
if (drafted.length) console.log(`  drafted, not assembled: ${drafted.join(", ")}`);
if (copied.length)
	console.log(`  COPY WARNING, existing files that match an edition: ${copied.join(", ")}`);
console.log(`  next: ${todo.slice(0, next).join(", ") || "none"}`);
