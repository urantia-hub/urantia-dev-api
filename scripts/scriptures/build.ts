// Downloads the phase 1 texts, parses them, and writes one JSON file per corpus.
// Run: bun scripts/scriptures/build.ts [outDir]
// Default outDir: ../urantia-data-sources/data/scriptures (next to this repo).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORPORA } from "./corpora.ts";
import {
	type Passage,
	parseAnalects,
	parseBesantGita,
	parseDhammapada,
	parseTaoTeChing,
} from "./parsers.ts";

const OUT =
	process.argv[2] ?? join(import.meta.dir, "../../../urantia-data-sources/data/scriptures");
const HEADERS = { "User-Agent": "urantia-dev-api/scriptures-build (kelson@urantia.dev)" };

async function gutenberg(id: number): Promise<string> {
	const res = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, {
		headers: HEADERS,
	});
	if (!res.ok) throw new Error(`Gutenberg ${id}: HTTP ${res.status}`);
	return res.text();
}

async function besantChapters(): Promise<Record<string, string>> {
	const chapters: Record<string, string> = {};
	for (let n = 1; n <= 18; n++) {
		const url = `https://en.wikisource.org/w/api.php?${new URLSearchParams({
			action: "parse",
			page: `Bhagavad-Gita (Besant 4th)/Discourse ${n}`,
			prop: "text",
			format: "json",
			formatversion: "2",
		})}`;
		const res = await fetch(url, { headers: HEADERS });
		if (!res.ok) throw new Error(`Wikisource discourse ${n}: HTTP ${res.status}`);
		chapters[String(n)] = ((await res.json()) as { parse: { text: string } }).parse.text;
		await new Promise((r) => setTimeout(r, 500));
	}
	return chapters;
}

const PARSE: Record<string, () => Promise<Passage[]>> = {
	"dhammapada-muller-1881": async () => parseDhammapada(await gutenberg(2017)),
	"tao-te-ching-legge-1891": async () => parseTaoTeChing(await gutenberg(216)),
	"analects-legge-1861": async () => parseAnalects(await gutenberg(4094)),
	"bhagavad-gita-besant-1922": async () => parseBesantGita(await besantChapters()),
};

mkdirSync(OUT, { recursive: true });
for (const corpus of CORPORA) {
	const passages = await PARSE[corpus.id]?.();
	if (!passages?.length) throw new Error(`${corpus.id}: no passages`);
	const refs = new Set(passages.map((p) => p.ref));
	if (refs.size !== passages.length) throw new Error(`${corpus.id}: repeated references`);
	writeFileSync(
		join(OUT, `${corpus.id}.json`),
		`${JSON.stringify({ corpus, passages }, null, "\t")}\n`,
	);
	console.log(`${corpus.id}: ${passages.length} passages`);
}
