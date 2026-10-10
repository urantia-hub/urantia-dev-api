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
	"tao-te-ching-legge-1891": { page: gutenberg(216), words: 10 },
	"analects-legge-1861": { page: gutenberg(4094), words: 24, exact: true },
	"koran-pickthall-1930": { page: gutenberg(16955), words: 24, exact: true },
	"dhammapada-muller-1881": { page: gutenberg(2017), words: 0 },
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
