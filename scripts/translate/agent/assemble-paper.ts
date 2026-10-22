/**
 * assemble-paper.ts — Check a draft and turn it into the seed files.
 *
 * Usage:
 *   bun scripts/translate/agent/assemble-paper.ts --lang=es --paper=1
 *   bun scripts/translate/agent/assemble-paper.ts --lang=es --papers=1,100 --candidate=gpt --dry-run
 *
 * Reads .work/translate/<lang>/<candidate>/paper-NNN.draft.json. With no errors, writes
 * data/translations/<lang>/paragraphs/paper-NNN.json and merges the titles into titles.json.
 * Exits 1 when any paper has an error. --dry-run only prints the report.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	COPY_LIMIT_PAPER_MEDIAN,
	checkParagraph,
	checkTitle,
	copyScore,
	editionsAvailable,
	type Issue,
} from "./checks.ts";
import {
	type Draft,
	draftPath,
	loadEnglishPaper,
	loadTermDecisions,
	outputPath,
	pad,
	type ParagraphTranslation,
	parseArgs,
	ROOT,
	stripTags,
	type TitleTranslation,
	termDecisionsPath,
	titlesPath,
} from "./lib.ts";

const { lang, papers, flags } = parseArgs();
const candidate = [...flags].find((a) => a.startsWith("--candidate="))?.split("=")[1] ?? "main";
const DRY_RUN = flags.has("--dry-run") || candidate !== "main";

let failed = 0;

for (const paper of papers) {
	const path = draftPath(lang, paper, candidate);
	if (!existsSync(path)) {
		console.log(`Paper ${paper}: no draft at ${path}`);
		failed++;
		continue;
	}
	const draft: Draft = JSON.parse(readFileSync(path, "utf-8"));
	const en = loadEnglishPaper(paper);

	const issues: Issue[] = [];
	const known = new Set(en.paragraphs.map((p) => p.ref));
	for (const ref of Object.keys(draft.paragraphs ?? {})) {
		if (!known.has(ref))
			issues.push({ ref, level: "error", check: "unknown", detail: "no such paragraph" });
	}
	for (const p of en.paragraphs)
		issues.push(...checkParagraph(lang, paper, p, draft.paragraphs?.[p.ref]));
	issues.push(...checkTitle(`paper ${paper}`, draft.paperTitle));
	for (const s of en.sections.filter((s) => s.title)) {
		issues.push(...checkTitle(`section ${s.id}`, draft.sectionTitles?.[s.id]));
	}

	const scores = en.paragraphs
		.filter((p) => draft.paragraphs?.[p.ref])
		.map((p) => copyScore(lang, paper, p.ref, stripTags(draft.paragraphs[p.ref]!)))
		.sort((a, b) => a - b);
	const median = scores[Math.floor(scores.length / 2)] ?? 0;
	if (editionsAvailable(lang, paper) === 0) {
		issues.push({
			ref: "paper",
			level: "warn",
			check: "copy",
			detail: "no existing edition on disk to compare",
		});
	} else if (median > COPY_LIMIT_PAPER_MEDIAN.error) {
		issues.push({
			ref: "paper",
			level: "error",
			check: "copy",
			detail: `median match ${median.toFixed(2)}`,
		});
	} else if (median > COPY_LIMIT_PAPER_MEDIAN.warn) {
		issues.push({
			ref: "paper",
			level: "warn",
			check: "copy",
			detail: `median match ${median.toFixed(2)}`,
		});
	}

	const errors = issues.filter((i) => i.level === "error");
	const warns = issues.filter((i) => i.level === "warn");
	console.log(
		`Paper ${paper} [${candidate}]: ${en.paragraphs.length} paragraphs, ${errors.length} errors, ${warns.length} warnings, copy median ${median.toFixed(2)}`,
	);
	for (const i of issues)
		console.log(`  ${i.level.padEnd(5)} ${i.ref.padEnd(10)} ${i.check}: ${i.detail}`);

	if (errors.length) {
		failed++;
		continue;
	}
	if (DRY_RUN) continue;

	const flagged = new Set(warns.map((w) => w.ref));
	const rows: ParagraphTranslation[] = en.paragraphs.map((p) => {
		const html = draft.paragraphs[p.ref]!;
		return {
			paragraphId: p.globalId,
			globalId: p.globalId,
			standardReferenceId: p.ref,
			language: lang,
			version: 1,
			text: stripTags(html),
			htmlText: html,
			source: "urantia.dev",
			confidence: flagged.has(p.ref) ? "needs_review" : "auto_checked",
		};
	});
	mkdirSync(dirname(outputPath(lang, paper)), { recursive: true });
	writeFileSync(outputPath(lang, paper), `${JSON.stringify(rows, null, "\t")}\n`);

	const titles: TitleTranslation[] = existsSync(titlesPath(lang))
		? JSON.parse(readFileSync(titlesPath(lang), "utf-8"))
		: [];
	const fresh: TitleTranslation[] = [
		{ sourceType: "paper" as const, sourceId: en.paperId, title: draft.paperTitle },
		...en.sections
			.filter((s) => s.title)
			.map((s) => ({
				sourceType: "section" as const,
				sourceId: s.id,
				title: draft.sectionTitles[s.id]!,
			})),
	].map((t) => ({
		...t,
		language: lang,
		version: 1,
		source: "urantia.dev",
		confidence: "auto_checked",
	}));
	const replaced = new Set(fresh.map((t) => `${t.sourceType}:${t.sourceId}`));
	const merged = [
		...titles.filter((t) => !replaced.has(`${t.sourceType}:${t.sourceId}`)),
		...fresh,
	];
	writeFileSync(titlesPath(lang), `${JSON.stringify(merged, null, "\t")}\n`);

	const decisions = loadTermDecisions(lang);
	const added = Object.entries(draft.newTerms ?? {}).filter(([en]) => !(en in decisions));
	for (const [en, tr] of Object.entries(draft.newTerms ?? {})) {
		if (decisions[en] && decisions[en] !== tr) {
			console.log(
				`  note: "${en}" is "${decisions[en]}" in term-decisions.json, but this paper used "${tr}"`,
			);
		}
	}
	if (added.length) {
		const sorted = Object.fromEntries(
			[...Object.entries(decisions), ...added].sort(([a], [b]) => a.localeCompare(b)),
		);
		writeFileSync(termDecisionsPath(lang), `${JSON.stringify(sorted, null, "\t")}\n`);
	}
	// The translator's notes stay with the paper, so a reviewer can see each forced choice.
	if (draft.forcedChoices?.length || draft.newTerms) {
		const notes = join(ROOT, `data/translations/${lang}/notes/paper-${pad(paper)}.json`);
		mkdirSync(dirname(notes), { recursive: true });
		const body = { newTerms: draft.newTerms ?? {}, forcedChoices: draft.forcedChoices ?? [] };
		writeFileSync(notes, `${JSON.stringify(body, null, "\t")}\n`);
	}
	console.log(
		`  wrote ${outputPath(lang, paper)}, ${fresh.length} titles, ${added.length} new terms`,
	);
}

process.exit(failed ? 1 : 0);
