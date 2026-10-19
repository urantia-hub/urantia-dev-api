// The address of a parallel passage on the public page that holds its text. An app shows it as
// "Open". A wrong link costs more trust than no link, so each function answers null when it is not sure.
// `scripts/check-parallel-links.ts` reads the real pages for a sample of passages.

// The World English Bible site names each book with its USFM code.
const USFM: Record<string, string> = Object.fromEntries(
	"Gen GEN Exod EXO Lev LEV Num NUM Deut DEU Josh JOS Judg JDG Ruth RUT 1Sam 1SA 2Sam 2SA 1Kgs 1KI 2Kgs 2KI 1Chr 1CH 2Chr 2CH Ezra EZR Neh NEH Esth EST Job JOB Ps PSA Prov PRO Eccl ECC Song SNG Isa ISA Jer JER Lam LAM Ezek EZK Dan DAN Hos HOS Joel JOL Amos AMO Obad OBA Jonah JON Mic MIC Nah NAM Hab HAB Zeph ZEP Hag HAG Zech ZEC Mal MAL Tob TOB Jdt JDT EsthGr ESG Wis WIS Sir SIR Bar BAR DanGr DAG 1Macc 1MA 2Macc 2MA 1Esd 1ES PrMan MAN AddPs PS2 3Macc 3MA 2Esd 2ES 4Macc 4MA Matt MAT Mark MRK Luke LUK John JHN Acts ACT Rom ROM 1Cor 1CO 2Cor 2CO Gal GAL Eph EPH Phil PHP Col COL 1Thess 1TH 2Thess 2TH 1Tim 1TI 2Tim 2TI Titus TIT Phlm PHM Heb HEB Jas JAS 1Pet 1PE 2Pet 2PE 1John 1JN 2John 2JN 3John 3JN Jude JUD Rev REV"
		.split(" ")
		.reduce<[string, string][]>(
			(pairs, code, i, all) => (i % 2 === 0 ? [...pairs, [code, all[i + 1] as string]] : pairs),
			[],
		),
);

const whole = (n: number) => Number.isInteger(n) && n > 0;

/** The chapter page of the World English Bible, at the first verse of the passage. */
export function bibleUrl(bookCode: string, chapter: number, verse: number): string | null {
	const book = USFM[bookCode];
	if (!book || !whole(chapter) || !whole(verse)) return null;
	const page = String(chapter).padStart(book === "PSA" ? 3 : 2, "0");
	return `https://ebible.org/eng-web/${book}${page}.htm#V${verse}`;
}

/**
 * A text fragment: the browser scrolls to these words and marks them. When the page does not hold
 * them in this form, the page opens at its top. A browser goes to the FIRST place that has the words,
 * so words that are in two places of a page can mark another passage. `exact` asks for a passage of at
 * least `count` words, and gives no fragment for a shorter one.
 */
export function textFragment(text: string, count = 5, exact = false): string {
	// A number at the start ("1. ") is the count of a part in our record, not a word of the page.
	const line = (text.trim().split("\n")[0] ?? "")
		.replace(/^\d+\.\s+/, "")
		.replace(/^["'“‘([]+/, "");
	const all = line.split(/\s+/).filter(Boolean);
	if (all.length === 0 || (exact && all.length < count)) return "";
	// A dash, a comma, and an ampersand are signs of the fragment syntax.
	return `#:~:text=${encodeURIComponent(all.slice(0, count).join(" ")).replace(/-/g, "%2D")}`;
}

// For each work: the page that holds the text that the API serves, and how many words take a browser
// to the passage. A page of one chapter needs few words. A page of a whole book has verses that start
// with the same words, so it needs many, and a passage shorter than that gets the page only.
// The numbers are from `scripts/check-parallel-links.ts`: each is the smallest that put no sample
// passage in two places. Zero means that no number did, and the link is the page only.
type Work = { page: (reference: string) => string | null; words: number; exact?: boolean };
const gutenberg = (id: number) => () =>
	`https://www.gutenberg.org/cache/epub/${id}/pg${id}-images.html`;
const page = (url: string) => () => url;
const wikisource = (title: string) =>
	`https://en.wikisource.org/wiki/${encodeURI(title.replace(/ /g, "_"))}`;
const PROSE_EDDA = /^(Prologue|Gylfaginning|Skáldskaparmál) \d/;
const KHANDOGYA = "First Second Third Fourth Fifth Sixth Seventh Eighth".split(" ");
// The books of each part of the Shû King, and the books whose text is on one page for each section.
const SHU_BOOKS = [1, 4, 4, 11, 30];
const SHU_SECTIONS = new Set(["3.1", "4.5", "4.7", "4.8", "5.1"]);

// Hymn pages whose text today is not Griffith's, read at the last revision before that edit
// (each found by a comparison with the 2005 import, 2026-10-18): 10.34 holds a translation revised
// after Macdonell (2006), 10.58.3 "four-eyed" (2023), 10.86.13-14 other text (2022), 10.97.6 added words (2021).
export const RIG_VEDA_PINNED: Record<string, number> = {
	"10.34": 54741,
	"10.58": 12150713,
	"10.86": 3747414,
	"10.97": 3747426,
};

const WORKS: Record<string, Work> = {
	"diogenes-laertius-6-hicks-1925": {
		page: page("https://en.wikisource.org/wiki/Lives_of_the_Eminent_Philosophers/Book_VI"),
		words: 10,
	},
	"epictetus-3-22-oldfather-1928": {
		page: page(
			"https://en.wikisource.org/wiki/Epictetus,_the_Discourses_as_reported_by_Arrian,_the_Manual,_and_Fragments/Book_3/Chapter_22",
		),
		words: 5,
	},
	"shinto-oracles-aston-1905": {
		page: page("https://en.wikisource.org/wiki/Shinto:_The_Way_of_the_Gods/Chapter_14"),
		words: 5,
	},
	"japji-macauliffe-1909": {
		page: page("https://en.wikisource.org/wiki/The_Sikh_Religion/Volume_1/Japji"),
		words: 5,
	},
	"bhagavad-gita-besant-1922": {
		// One page for each of the 18 discourses.
		page: (reference) => {
			const discourse = /^BG ([1-9]|1[0-8])\./.exec(reference)?.[1];
			return discourse
				? `https://en.wikisource.org/wiki/Bhagavad-Gita_(Besant_4th)/Discourse_${discourse}`
				: null;
		},
		words: 5,
	},
	"rig-veda-griffith-1896": {
		// One page for each hymn: "RV 10.129.1" is on Book 10, Hymn 129.
		page: (reference) => {
			const m = /^RV (10|[1-9])\.([1-9]\d{0,2})\./.exec(reference);
			if (!m) return null;
			const pinned = RIG_VEDA_PINNED[`${m[1]}.${m[2]}`];
			return pinned
				? `https://en.wikisource.org/w/index.php?oldid=${pinned}`
				: `https://en.wikisource.org/wiki/The_Hymns_of_the_Rigveda/Book_${m[1]}/Hymn_${m[2]}`;
		},
		words: 5,
	},
	"tao-te-ching-legge-1891": { page: gutenberg(216), words: 10 },
	"analects-legge-1861": { page: gutenberg(4094), words: 24, exact: true },
	"koran-pickthall-1930": { page: gutenberg(16955), words: 24, exact: true },
	"dhammapada-muller-1881": { page: gutenberg(2017), words: 0 },
	"book-of-mormon-1830": { page: gutenberg(17), words: 24, exact: true },
	"kojiki-chamberlain-1882": {
		// One page for each of the 180 sections.
		page: (reference) => {
			const n = Number(/^Kojiki (\d+)\./.exec(reference)?.[1]);
			return n >= 1 && n <= 180 ? wikisource(`Kojiki (Chamberlain, 1882)/Section ${n}`) : null;
		},
		words: 24,
	},
	"prose-edda-brodeur-1916": {
		page: (reference) => {
			const part = PROSE_EDDA.exec(reference)?.[1];
			return part
				? wikisource(`The Prose Edda (1916 translation by Arthur Gilchrist Brodeur)/${part}`)
				: null;
		},
		words: 24,
	},
	"upanishads-muller-1879": {
		page: (reference) => {
			const v1 = "Sacred Books of the East/Volume 1/";
			const k = /^Khandogya ([1-8])\./.exec(reference)?.[1];
			if (k) return wikisource(`${v1}Khândogya-upanishad/${KHANDOGYA[Number(k) - 1]} Prapâthaka`);
			if (/^Kena \d/.test(reference)) return wikisource(`${v1}Talavakâra-upanishad`);
			if (/^Isa \d/.test(reference)) return wikisource(`${v1}Vâgasaneyi-samhitâ-upanishad`);
			return null;
		},
		words: 24,
	},
	"shu-king-legge-1879": {
		page: (reference) => {
			const m = /^Shu ([1-5])\.(\d+)\.\d/.exec(reference);
			if (!m) return null;
			const [part, book] = [Number(m[1]), Number(m[2])];
			if (book < 1 || book > (SHU_BOOKS[part - 1] as number) || SHU_SECTIONS.has(`${part}.${book}`))
				return null;
			return wikisource(`Sacred Books of the East/Volume 3/The Shu/Part ${part}/Book ${book}`);
		},
		words: 24,
	},
	// Repeated chapters: 24 first words were in two places for 13 passages, so no fragment.
	"book-of-the-dead-renouf-1904": { page: gutenberg(69566), words: 0 },
	"hesiod-evelyn-white-1914": { page: gutenberg(348), words: 24, exact: true },
	"homeric-hymns-evelyn-white-1914": { page: gutenberg(348), words: 24, exact: true },
	"poetic-edda-bellows-1923": { page: gutenberg(73533), words: 24, exact: true },
	"aztec-hymns-brinton-1890": { page: gutenberg(14993), words: 24, exact: true },
	"chuang-tzu-giles-1889": { page: gutenberg(59709), words: 24, exact: true },
};

/** The page that holds a passage of a work, or null. */
export function workPage(corpusId: string, reference: string): string | null {
	return WORKS[corpusId]?.page(reference) ?? null;
}

/**
 * The page of the work that holds the passage, with the words that take a browser to it. `anchor` is
 * the stored run of words that is in one place of that page (`scripture_chunks.anchor`). Without it,
 * the rule of the work applies: its first words, or the page only.
 */
export function scriptureUrl(
	corpusId: string,
	reference: string,
	text: string,
	anchor?: string | null,
): string | null {
	const work = WORKS[corpusId];
	const url = work?.page(reference);
	if (!work || !url) return null;
	if (anchor) return `${url}#:~:text=${encodeURIComponent(anchor).replace(/-/g, "%2D")}`;
	return work.words > 0 ? `${url}${textFragment(text, work.words, work.exact)}` : url;
}
