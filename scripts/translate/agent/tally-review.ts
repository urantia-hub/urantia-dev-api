/**
 * tally-review.ts — Unblind the judges' answers and rank the candidates.
 *
 * Usage: bun scripts/translate/agent/tally-review.ts --lang=es
 *
 * Reads .work/translate/<lang>/review/key.json and judges/<judge>/paper-NNN.json.
 * Prints mean rank and scores per candidate, with and without each candidate's own family
 * as judge, and writes disagreements.md: the paragraphs where judges disagree most.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, WORK_DIR } from "./lib.ts";

type Verdict = {
	ranking: string[];
	scores: Record<string, Record<string, number>>;
	note?: string;
};

const { lang } = parseArgs();
const dir = join(WORK_DIR, lang, "review");
const key: Record<string, Record<string, string>> = JSON.parse(
	readFileSync(join(dir, "key.json"), "utf-8"),
);
const family = (name: string) => name.split("-")[0]!;

type Row = {
	judge: string;
	paper: string;
	ref: string;
	candidate: string;
	rank: number;
	scores: Record<string, number>;
	note?: string;
};
const rows: Row[] = [];
const judgesDir = join(dir, "judges");
const judges = existsSync(judgesDir) ? readdirSync(judgesDir) : [];

for (const judge of judges) {
	for (const file of readdirSync(join(judgesDir, judge)).filter((f) => f.endsWith(".json"))) {
		const paper = String(Number(file.match(/\d+/)![0]));
		const labels = key[paper];
		if (!labels) continue;
		const verdicts: Record<string, Verdict> = JSON.parse(
			readFileSync(join(judgesDir, judge, file), "utf-8"),
		);
		for (const [ref, v] of Object.entries(verdicts)) {
			v.ranking.forEach((label, i) => {
				const candidate = labels[label];
				if (candidate)
					rows.push({
						judge,
						paper,
						ref,
						candidate,
						rank: i + 1,
						scores: v.scores?.[label] ?? {},
						note: v.note,
					});
			});
		}
	}
}

if (!rows.length) {
	console.log("No judge answers yet.");
	process.exit(0);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
const candidates = [...new Set(rows.map((r) => r.candidate))];
const criteria = ["accuracy", "terms", "register", "fluency"];

console.log(`Judges: ${judges.join(", ")}  (${rows.length} rankings)\n`);
console.log(
	`candidate         rank  rank*  ${criteria.map((c) => c.slice(0, 8).padEnd(8)).join(" ")}`,
);
for (const c of candidates.sort(
	(a, b) =>
		mean(rows.filter((r) => r.candidate === a).map((r) => r.rank)) -
		mean(rows.filter((r) => r.candidate === b).map((r) => r.rank)),
)) {
	const mine = rows.filter((r) => r.candidate === c);
	const fair = mine.filter((r) => family(r.judge) !== family(c));
	console.log(
		`${c.padEnd(16)} ${mean(mine.map((r) => r.rank))
			.toFixed(2)
			.padStart(5)} ${mean(fair.map((r) => r.rank))
			.toFixed(2)
			.padStart(6)}  ${criteria
			.map((k) =>
				mean(mine.map((r) => r.scores[k] ?? Number.NaN).filter((x) => !Number.isNaN(x)))
					.toFixed(2)
					.padEnd(8),
			)
			.join(" ")}`,
	);
}
console.log(
	"\nrank = mean rank from all judges (1 is best). rank* = without judges of the same family.",
);

// Per paragraph, the spread of each candidate's rank across judges.
const byRef = new Map<string, Row[]>();
for (const r of rows)
	byRef.set(`${r.paper}|${r.ref}`, [...(byRef.get(`${r.paper}|${r.ref}`) ?? []), r]);
const spread = [...byRef.entries()]
	.map(([k, rs]) => {
		const s = candidates.map((c) => {
			const ranks = rs.filter((r) => r.candidate === c).map((r) => r.rank);
			return ranks.length ? Math.max(...ranks) - Math.min(...ranks) : 0;
		});
		return { k, rs, score: mean(s) };
	})
	.sort((a, b) => b.score - a.score)
	.slice(0, 20);

const md = spread
	.map(({ k, rs }) => {
		const [paper, ref] = k.split("|");
		const lines = rs.map(
			(r) => `- ${r.judge} ranked ${r.candidate} #${r.rank}${r.note ? `: ${r.note}` : ""}`,
		);
		return `## Paper ${paper}, ${ref}\n\n${[...new Set(lines)].join("\n")}`;
	})
	.join("\n\n");
writeFileSync(
	join(dir, "disagreements.md"),
	`# Paragraphs where the judges disagree most\n\n${md}\n`,
);
console.log(`Top disagreements for a human tiebreak: ${join(dir, "disagreements.md")}`);
