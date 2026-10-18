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
	parseBookOfMormon,
	parseDhammapada,
	parseGriffithRigVeda,
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

async function wikisource(page: string, oldid?: number): Promise<string> {
	const which: Record<string, string> = oldid ? { oldid: String(oldid) } : { page };
	const url = `https://en.wikisource.org/w/api.php?${new URLSearchParams({ action: "parse", ...which, prop: "text", format: "json", formatversion: "2" })}`;
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) throw new Error(`Wikisource ${page}: HTTP ${res.status}`);
	return ((await res.json()) as { parse: { text: string } }).parse.text;
}

// Hymn pages whose text today is not Griffith's, read at the last revision before that edit
// (each found by a comparison with the 2005 import, 2026-10-18): 10.34 holds a translation revised
// after Macdonell (2006), 10.58.3 "four-eyed" (2023), 10.86.13-14 other text (2022), 10.97.6 added words (2021).
const RIG_VEDA_PINNED: Record<string, number> = {
	"10.34": 54741,
	"10.58": 12150713,
	"10.86": 3747414,
	"10.97": 3747426,
};

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

/** Every hymn page of Griffith's Rig Veda on Wikisource, keyed "book.hymn" (1,028 pages). */
async function rigVedaHymns(): Promise<Record<string, string>> {
	const titles: string[] = [];
	let from: Record<string, string> = {};
	for (;;) {
		const url = `https://en.wikisource.org/w/api.php?${new URLSearchParams({
			action: "query",
			list: "allpages",
			apprefix: "The Hymns of the Rigveda/",
			aplimit: "500",
			format: "json",
			...from,
		})}`;
		const res = await fetch(url, { headers: HEADERS });
		if (!res.ok) throw new Error(`Wikisource page list: HTTP ${res.status}`);
		const body = (await res.json()) as {
			query: { allpages: { title: string }[] };
			continue?: Record<string, string>;
		};
		titles.push(...body.query.allpages.map((p) => p.title));
		if (!body.continue) break;
		from = body.continue;
	}
	const hymns: Record<string, string> = {};
	for (const title of titles) {
		const m = /\/Book (\d+)\/Hymn (\d+)$/.exec(title);
		if (!m) continue;
		const key = `${m[1]}.${m[2]}`;
		hymns[key] = await wikisource(title, RIG_VEDA_PINNED[key]);
		await new Promise((r) => setTimeout(r, 500));
	}
	if (Object.keys(hymns).length !== 1028)
		throw new Error(`Rig Veda: ${Object.keys(hymns).length} hymns, not 1028`);
	return hymns;
}

const PARSE: Record<string, () => Promise<Passage[]>> = {
	"dhammapada-muller-1881": async () => parseDhammapada(await gutenberg(2017)),
	"tao-te-ching-legge-1891": async () => parseTaoTeChing(await gutenberg(216)),
	"analects-legge-1861": async () => parseAnalects(await gutenberg(4094)),
	"bhagavad-gita-besant-1922": async () => parseBesantGita(await besantChapters()),
	"shinto-oracles-aston-1905": async () =>
		parseAstonOracles(await wikisource("Shinto: The Way of the Gods/Chapter 14")),
	"koran-pickthall-1930": async () => parsePickthall(await gutenberg(16955)),
	"book-of-mormon-1830": async () => {
		const passages = parseBookOfMormon(await gutenberg(17));
		// The standard count of the 15 books.
		if (passages.length !== 6604)
			throw new Error(`Book of Mormon: ${passages.length} verses, not 6604`);
		return passages;
	},
	"rig-veda-griffith-1896": async () => parseGriffithRigVeda(await rigVedaHymns()),
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
