/**
 * check-papers.ts — Assemble each paper, print one summary line, and write a redo packet for copy errors.
 *
 * Usage: bun scripts/translate/agent/check-papers.ts --lang=es --papers=120-139
 *
 * Papers run one at a time, because assembly writes term-decisions.json.
 */

import { pad, parseArgs, WORK_DIR } from "./lib.ts";

const { lang, papers } = parseArgs();
const dir = import.meta.dir;

function run(script: string, args: string[]): string {
	const res = Bun.spawnSync(["bun", `${dir}/${script}`, `--lang=${lang}`, ...args], {
		stderr: "pipe",
	});
	return res.stdout.toString() + res.stderr.toString();
}

let totalCopy = 0;
for (const paper of papers) {
	const out = run("assemble-paper.ts", [`--paper=${paper}`]).split("\n");
	const errors = out.filter((l) => l.startsWith("  error"));
	const copy = errors.filter((l) => l.includes("copy:")).length;
	const other = errors.length - copy;
	const warnings = out.filter((l) => l.includes("warn")).length;
	console.log(`paper ${paper}: copy errors ${copy}, other errors ${other}, warnings ${warnings}`);
	for (const l of errors.filter((l) => !l.includes("copy:")).slice(0, 5)) console.log(l);
	totalCopy += copy;
	if (copy > 0) {
		run("prepare-paper.ts", [`--paper=${paper}`, "--redo"]);
		console.log(`  redo packet: ${WORK_DIR}/${lang}/main/paper-${pad(paper)}.redo.packet.md`);
	}
}
console.log(`${papers.length} papers, ${totalCopy} copy errors`);
