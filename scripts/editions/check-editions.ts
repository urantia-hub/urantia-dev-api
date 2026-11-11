// Checks the editions against whole texts. Exits 1 on a failure.
// Usage: bun scripts/editions/check-editions.ts <stored json dir> [<srt-2021 json dir>]
// <stored json dir>: the seed JSON (download 1.22). <srt-2021 json dir>: the January 2024 download.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	EDITIONS,
	htmlInEdition,
	resolveEdition,
	textInEdition,
	VARIANTS,
} from "../../src/lib/editions.ts";

type Row = { standardReferenceId?: string; text?: string | null; htmlText?: string | null };

function load(dir: string): Map<string, Row> {
	const out = new Map<string, Row>();
	for (const f of readdirSync(dir).filter((n) => /^\d{3}\.json$/.test(n))) {
		for (const p of JSON.parse(readFileSync(join(dir, f), "utf8")) as Row[]) {
			if (p.standardReferenceId && p.text != null) out.set(p.standardReferenceId, p);
		}
	}
	return out;
}

const [storedDir, srt2021Dir] = process.argv.slice(2);
if (!storedDir) {
	console.error(
		"Usage: bun scripts/editions/check-editions.ts <stored json dir> [<srt-2021 json dir>]",
	);
	process.exit(1);
}
const stored = load(storedDir);
let failed = 0;
const fail = (msg: string) => {
	failed++;
	console.error(`FAIL ${msg}`);
};

// 1. Each text row is in its paragraph: the new wording in one place, or (not in the download) the old.
const count = (s: string, part: string) => s.split(part).length - 1;
let htmlOnce = 0;
const htmlMissing: string[] = [];
for (const v of VARIANTS) {
	const p = stored.get(v.ref);
	if (!p?.text) {
		fail(`${v.ref}: no paragraph`);
		continue;
	}
	if (v.kind !== "text") continue;
	const side = v.inStoredText ? v.after : v.before;
	if (count(p.text, side) !== 1)
		fail(`${v.ref}: "${side}" must be in one place, is in ${count(p.text, side)}`);
	if (v.inStoredText && p.htmlText && count(p.htmlText, v.after) === 1) htmlOnce++;
	else if (v.inStoredText) htmlMissing.push(v.ref);
}
const textRows = VARIANTS.filter((v) => v.kind === "text" && v.inStoredText).length;
console.log(`check 1: ${textRows} text rows hold in the stored text`);
console.log(
	`  htmlText holds the words in one place for ${htmlOnce}; not as plain words for ${htmlMissing.length}: ${htmlMissing.join(", ")}`,
);

// Each edition builds for every paragraph with a variant.
for (const e of EDITIONS) {
	for (const ref of new Set(VARIANTS.map((v) => v.ref))) {
		const p = stored.get(ref);
		if (!p?.text) continue;
		try {
			const text = textInEdition(ref, p.text, e);
			// The HTML of the edition, without its tags, is the text of the edition.
			if (p.htmlText != null) {
				const plain = htmlInEdition(ref, p.htmlText, e).replace(/<[^>]*>/g, "");
				if (plain !== text) fail(`${e.id} ${ref}: the html without tags is not the text`);
			}
		} catch (err) {
			fail(`${e.id} ${ref}: ${(err as Error).message}`);
		}
	}
}
console.log(`  each of the ${EDITIONS.length} editions builds, text and html`);

// 2. srt-2021 built from the stored text equals the January 2024 download, word for word.
if (srt2021Dir) {
	const old = load(srt2021Dir);
	const e = resolveEdition("srt-2021");
	if (!e) throw new Error("no srt-2021");
	let same = 0;
	const spacing: string[] = []; // Table rows where our seed adds a space between label and number.
	for (const [ref, p] of stored) {
		const want = old.get(ref)?.text;
		if (want == null) {
			fail(`${ref}: not in the srt-2021 text`);
			continue;
		}
		const got = textInEdition(ref, p.text ?? "", e);
		if (got === want) same++;
		else if (got.replace(/\s+/g, "") === want.replace(/\s+/g, "")) spacing.push(ref);
		else
			fail(
				`${ref}: srt-2021 differs: built "${got.slice(0, 80)}" / download "${want.slice(0, 80)}"`,
			);
	}
	if (old.size !== stored.size) fail(`paragraph counts differ: ${stored.size} and ${old.size}`);
	console.log(
		`check 2: srt-2021 equals the January 2024 download for ${same} of ${stored.size} paragraphs`,
	);
	console.log(
		`  ${spacing.length} more differ in white space only (table rows): ${spacing.join(", ")}`,
	);
}

if (failed > 0) {
	console.error(`${failed} failures`);
	process.exit(1);
}
console.log("all checks pass");
