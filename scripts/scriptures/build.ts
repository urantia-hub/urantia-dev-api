// Downloads the texts, parses them, and writes one JSON file per corpus.
// Run: bun scripts/scriptures/build.ts [outDir]. ONLY=id,id builds just those corpora.
// Default outDir: ../urantia-data-sources/data/scriptures (next to this repo).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORPORA } from "./corpora.ts";
import {
	type Passage,
	parseAnalects,
	parseAstonOracles,
	parseBesantGita,
	parseDhammapada,
	parseHicksBook6,
	parseJapji,
	parseOldfatherChapter,
	parsePickthall,
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

async function wikisource(page: string): Promise<string> {
	const url = `https://en.wikisource.org/w/api.php?${new URLSearchParams({ action: "parse", page, prop: "text", format: "json", formatversion: "2" })}`;
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) throw new Error(`Wikisource ${page}: HTTP ${res.status}`);
	return ((await res.json()) as { parse: { text: string } }).parse.text;
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
	"shinto-oracles-aston-1905": async () =>
		parseAstonOracles(await wikisource("Shinto: The Way of the Gods/Chapter 14")),
	"koran-pickthall-1930": async () => parsePickthall(await gutenberg(16955)),
	"japji-macauliffe-1909": async () =>
		parseJapji(await wikisource("The Sikh Religion/Volume 1/Japji")),
	"diogenes-laertius-6-hicks-1925": async () =>
		parseHicksBook6(await wikisource("Lives of the Eminent Philosophers/Book VI")),
	// 3.22 ends at section 109 in the standard (Schenkl) numbering.
	"epictetus-3-22-oldfather-1928": async () =>
		parseOldfatherChapter(
			await wikisource(
				"Epictetus, the Discourses as reported by Arrian, the Manual, and Fragments/Book 3/Chapter 22",
			),
			3,
			22,
			109,
		),
};

mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY?.split(",");
for (const corpus of CORPORA.filter((c) => !only || only.includes(c.id))) {
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
