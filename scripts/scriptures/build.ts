// Downloads the texts, parses them, and writes one JSON file per corpus.
// Run: bun scripts/scriptures/build.ts [outDir]. ONLY=id,id builds just those corpora.
// Default outDir: ../urantia-data-sources/data/scriptures (next to this repo).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RIG_VEDA_PINNED } from "../../src/lib/parallel-links.ts";
import { CORPORA } from "./corpora.ts";
import {
	type Passage,
	PROSE_EDDA_PARTS,
	parseAnalects,
	parseAstonOracles,
	parseBellowsEdda,
	parseBesantGita,
	parseBookOfMormon,
	parseBrintonHymns,
	parseBrodeurProseEdda,
	parseChamberlainKojiki,
	parseDhammapada,
	parseGilesChuangTzu,
	parseGriffithRigVeda,
	parseHesiod,
	parseHicksBook6,
	parseHomericHymns,
	parseJapji,
	parseLeggeShuKing,
	parseMullerUpanishads,
	parseOldfatherChapter,
	parsePickthall,
	parseRenoufBookOfTheDead,
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

/** Wikisource pages by key, one request at a time with a pause: a fast run gets refused. */
async function wikisourcePages(titles: Record<string, string>): Promise<Record<string, string>> {
	const pages: Record<string, string> = {};
	for (const [key, title] of Object.entries(titles)) {
		pages[key] = await wikisource(title);
		await new Promise((r) => setTimeout(r, 500));
	}
	return pages;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const SBE1 = "Sacred Books of the East/Volume 1/";
const KHANDOGYA = "First Second Third Fourth Fifth Sixth Seventh Eighth".split(" ");
// The Shû King: the books of each part, and the books whose text is on a page for each section.
const SHU_BOOKS = [1, 4, 4, 11, 30];
const SHU_SECTIONS: Record<string, number> = { "3.1": 2, "4.5": 3, "4.7": 3, "4.8": 3, "5.1": 3 };

function shuTitles(): Record<string, string> {
	const titles: Record<string, string> = {};
	SHU_BOOKS.forEach((books, i) => {
		for (const book of range(books)) {
			const key = `${i + 1}.${book}`;
			const at = `Sacred Books of the East/Volume 3/The Shu/Part ${i + 1}/Book ${book}`;
			const sections = SHU_SECTIONS[key];
			if (!sections) titles[key] = at;
			else for (const n of range(sections)) titles[`${key}.${n}`] = `${at}/Section ${n}`;
		}
	});
	return titles;
}

/** Stops the build when a source does not give the count of hymns, poems, or chapters that it has. */
function parts(
	passages: Passage[],
	count: number,
	name: string,
	by: (p: Passage) => string = (p) => p.division,
): Passage[] {
	const found = new Set(passages.map(by)).size;
	if (found !== count) throw new Error(`${name}: ${found} parts, not ${count}`);
	return passages;
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
	// 186 chapters, less the 17 that are only a picture, a repeat, a part of another, or a description.
	"book-of-the-dead-renouf-1904": async () =>
		parts(parseRenoufBookOfTheDead(await gutenberg(69566)), 169, "Book of the Dead"),
	"hesiod-evelyn-white-1914": async () => parts(parseHesiod(await gutenberg(348)), 2, "Hesiod"),
	"homeric-hymns-evelyn-white-1914": async () =>
		parts(parseHomericHymns(await gutenberg(348)), 33, "Homeric Hymns"),
	"poetic-edda-bellows-1923": async () =>
		parts(parseBellowsEdda(await gutenberg(73533)), 35, "Poetic Edda"),
	"aztec-hymns-brinton-1890": async () =>
		parts(parseBrintonHymns(await gutenberg(14993)), 20, "Aztec hymns"),
	"chuang-tzu-giles-1889": async () =>
		parts(parseGilesChuangTzu(await gutenberg(59709)), 33, "Chuang Tzu"),
	"prose-edda-brodeur-1916": async () =>
		parts(
			parseBrodeurProseEdda(
				await wikisourcePages(
					Object.fromEntries(
						PROSE_EDDA_PARTS.map((part) => [
							part,
							`The Prose Edda (1916 translation by Arthur Gilchrist Brodeur)/${part}`,
						]),
					),
				),
			),
			133, // chapters: 5 of the Prologue, 54 of Gylfaginning, 74 of Skáldskaparmál
			"Prose Edda",
			(p) => `${p.division}.${p.subdivision}`,
		),
	"kojiki-chamberlain-1882": async () =>
		parts(
			parseChamberlainKojiki(
				await wikisourcePages(
					Object.fromEntries(
						range(180).map((n) => [String(n), `Kojiki (Chamberlain, 1882)/Section ${n}`]),
					),
				),
			),
			180,
			"Kojiki",
		),
	"upanishads-muller-1879": async () =>
		parts(
			parseMullerUpanishads(
				await wikisourcePages({
					...Object.fromEntries(
						KHANDOGYA.map((w, i) => [
							`Khandogya ${i + 1}`,
							`${SBE1}Khândogya-upanishad/${w} Prapâthaka`,
						]),
					),
					Kena: `${SBE1}Talavakâra-upanishad`,
					Isa: `${SBE1}Vâgasaneyi-samhitâ-upanishad`,
				}),
			),
			// The Khândogya has 154 Khandas (13, 24, 19, 17, 24, 16, 26, 15), the Kena 35 verses, the Îsâ 18.
			154 + 35 + 18,
			"Upanishads",
			(p) => p.ref,
		),
	"shu-king-legge-1879": async () =>
		parts(
			parseLeggeShuKing(await wikisourcePages(shuTitles())),
			50,
			"Shu King",
			(p) => `${p.division}.${p.subdivision}`,
		),
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
