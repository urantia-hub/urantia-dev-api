// Parsers that turn public domain source files into numbered passages.
// Each passage keeps the source's own wording; only page furniture is removed.

export type Passage = {
	ref: string; // "Dhp 5", "TTC 1.2", "Analects 1.1", "BG 2.47"
	sort: number; // reading order within the corpus
	division: string; // the chapter or book the passage belongs to, for chunking
	divisionTitle: string | null;
	subdivision?: number; // the chapter inside a book, for three-level refs ("Epictetus 3.22.5")
	text: string;
};

const clean = (s: string) =>
	s
		.replace(/​/g, "")
		.replace(/\s+/g, " ")
		.replace(/\s+([,.;:!?])/g, "$1")
		.trim();

/** The Gutenberg body, without the license header and footer. */
export function gutenbergBody(text: string): string {
	const start = text.search(/\*\*\* START OF TH(E|IS) PROJECT GUTENBERG EBOOK.*\*\*\*/);
	const end = text.search(/\*\*\* END OF TH(E|IS) PROJECT GUTENBERG EBOOK/);
	return text.slice(start >= 0 ? text.indexOf("\n", start) + 1 : 0, end >= 0 ? end : undefined);
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
export function romanToInt(roman: string): number {
	let total = 0;
	for (let i = 0; i < roman.length; i++) {
		const value = ROMAN[roman[i] as string] ?? 0;
		const next = ROMAN[roman[i + 1] as string] ?? 0;
		total += value < next ? -value : value;
	}
	return total;
}

/** Dhammapada (Muller, 1881, Gutenberg 2017): "Chapter I. The Twin-Verses", then "1. text". */
export function parseDhammapada(raw: string): Passage[] {
	const passages: Passage[] = [];
	let chapter = 0;
	let chapterTitle: string | null = null;
	let current: { n: number; last: number; lines: string[] } | null = null;
	const flush = () => {
		if (!current) return;
		passages.push({
			// Muller prints some pairs as one verse: "58, 59. text" becomes "Dhp 58-59".
			ref: current.last > current.n ? `Dhp ${current.n}-${current.last}` : `Dhp ${current.n}`,
			sort: current.n,
			division: String(chapter),
			divisionTitle: chapterTitle,
			text: clean(current.lines.join(" ")),
		});
		current = null;
	};
	for (const line of gutenbergBody(raw).split(/\r?\n/)) {
		const heading = line.match(/^Chapter ([IVXL]+)\. (.+?)\.?\s*$/);
		if (heading) {
			flush();
			chapter = romanToInt(heading[1] as string);
			chapterTitle = (heading[2] as string).trim();
			continue;
		}
		if (chapter === 0) continue;
		const verse = line.match(/^(\d{1,3})(?:, (\d{1,3}))?\. (.*)$/);
		if (verse) {
			flush();
			const n = Number(verse[1]);
			current = { n, last: verse[2] ? Number(verse[2]) : n, lines: [verse[3] as string] };
		} else if (current && line.trim()) {
			current.lines.push(line.trim());
		}
	}
	flush();
	return passages;
}

/** Tao Te Ching (Legge, 1891, Gutenberg 216): "Ch. 1. 1. text" or "2. 1. text", then "2. text". */
export function parseTaoTeChing(raw: string): Passage[] {
	const passages: Passage[] = [];
	let chapter = 0;
	let current: { p: number; lines: string[] } | null = null;
	const flush = () => {
		if (!current) return;
		const text = clean(current.lines.join(" "));
		if (text) {
			passages.push({
				ref: `TTC ${chapter}.${current.p}`,
				sort: chapter * 100 + current.p,
				division: String(chapter),
				divisionTitle: null,
				text,
			});
		}
		current = null;
	};
	for (const line of gutenbergBody(raw).split(/\r?\n/)) {
		if (/^PART \d+\.?\s*$/.test(line.trim())) continue;
		const start = line.match(/^(?:Ch\. )?(\d{1,2})\. 1\.\s*(.*)$/);
		const para = line.match(/^(?:Ch\. )?(\d{1,2})\.\s*(.*)$/);
		const n = para ? Number(para[1]) : 0;
		const nextParagraph: number = (current?.p ?? 0) + 1;
		if (start && Number(start[1]) === chapter + 1) {
			flush();
			chapter = Number(start[1]);
			current = { p: 1, lines: [start[2] as string] };
		} else if (para && n === chapter + 1 && n !== nextParagraph) {
			// A chapter of one paragraph has no "1." after its number: "11. The thirty spokes".
			flush();
			chapter = n;
			current = { p: 1, lines: [para[2] as string] };
		} else if (chapter > 0 && para && n === nextParagraph) {
			flush();
			current = { p: n, lines: [para[2] as string] };
		} else if (current && line.trim()) {
			current.lines.push(line.trim());
		}
	}
	flush();
	return passages;
}

const CJK = /[　-〿㐀-鿿＀-￯【】]/;

/**
 * The Gutenberg Analects misprints a few chapter numbers ("17, 17, 19" or "22, 32, 24",
 * and "46, 46" at the end of book 14). A number that breaks the sequence, when the next
 * one continues it, or a repeat at the end of a book, is the missing number.
 */
export function fixMisprintedChapters(passages: Passage[]): Passage[] {
	const out: Passage[] = [];
	for (let i = 0; i < passages.length; i++) {
		const p = passages[i] as Passage;
		const prev = out[out.length - 1];
		const next = passages[i + 1];
		const [book, chapter] = p.ref.replace("Analects ", "").split(".").map(Number) as [
			number,
			number,
		];
		const sameBookPrev = prev && prev.division === p.division ? Number(prev.ref.split(".")[1]) : 0;
		const expected = sameBookPrev + 1;
		const nextChapter =
			next && next.division === p.division ? Number(next.ref.split(".")[1]) : null;
		const misprint =
			chapter !== expected &&
			(nextChapter === expected + 1 || (nextChapter === null && chapter <= sameBookPrev));
		const c = misprint ? expected : chapter;
		out.push({ ...p, ref: `Analects ${book}.${c}`, sort: book * 1000 + c });
	}
	return out;
}

/** Analects (Legge, 1861, Gutenberg 4094): "BOOK I.", then "CHAPTER I. 1. text" / "CHAP. II. text". Chinese lines are dropped. */
export function parseAnalects(raw: string): Passage[] {
	const passages: Passage[] = [];
	let book = 0;
	let bookTitle: string | null = null;
	let current: { c: number; lines: string[] } | null = null;
	const flush = () => {
		if (!current) return;
		passages.push({
			ref: `Analects ${book}.${current.c}`,
			sort: book * 1000 + current.c,
			division: String(book),
			divisionTitle: bookTitle,
			text: clean(current.lines.join(" ")),
		});
		current = null;
	};
	const body = gutenbergBody(raw);
	const startAt = body.indexOf("BOOK I.");
	for (const line of body.slice(startAt).split(/\r?\n/)) {
		if (CJK.test(line)) continue;
		const bookHead = line.match(/^BOOK ([IVXL]+)\.\s+(.+?)\.?\s*$/);
		if (bookHead) {
			flush();
			book = romanToInt(bookHead[1] as string);
			bookTitle = (bookHead[2] as string).trim();
			continue;
		}
		const chap = line.match(/^\s*(?:CHAPTER|CHAP\.?) ([IVXL]+)\.?\s+(.*)$/);
		if (chap && book > 0) {
			flush();
			current = { c: romanToInt(chap[1] as string), lines: [chap[2] as string] };
		} else if (current && line.trim()) {
			current.lines.push(line.trim());
		}
	}
	flush();
	return fixMisprintedChapters(passages).map((p) => ({
		...p,
		// Drop the numbers Legge puts before each sentence within a chapter ("1. ", "2. ").
		text: p.text.replace(/(^|\s)\d{1,2}\.\s(?=['"A-Z(])/g, "$1").trim(),
	}));
}

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/** Decodes the HTML entities that Wikisource uses, named and numeric. */
function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
		.replace(/&nbsp;/g, " ")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

/**
 * Bhagavad Gita (Besant, 4th edition 1922, Wikisource). Each verse is Sanskrit ending in
 * "॥ N ॥", then its English. The English of verse N is the text from that marker to the
 * next Sanskrit. The number comes from the Sanskrit, because the English labels have
 * misprints (17.19 is labeled "(20)"), lose a parenthesis at page breaks, or are missing.
 */
export function parseBesantGita(htmlByChapter: Record<string, string>): Passage[] {
	const passages: Passage[] = [];
	for (const [chapterKey, html] of Object.entries(htmlByChapter)) {
		const chapter = Number(chapterKey);
		const text = decodeEntities(
			html
				.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, "")
				.replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, "")
				.replace(/<[^>]+>/g, " "),
		)
			.replace(/\[\s*\d+\s*\]/g, " ") // page and footnote markers
			.replace(/[\u200b\u00a0]/g, " ");
		for (const m of text.matchAll(/॥\s*([०-९]+)\s*॥([^\u0900-\u097F]*)/g)) {
			const verse = Number([...(m[1] as string)].map((d) => DEVANAGARI_DIGITS.indexOf(d)).join(""));
			const english = clean((m[2] as string).replace(/\(?\s*\d{1,2}\s*\)?\s*$/, ""));
			// Skip the closing line of a chapter: its Sanskrit ends with the chapter number.
			if (!english || /^Thus in the glorious Upanishads/.test(english)) continue;
			passages.push({
				ref: `BG ${chapter}.${verse}`,
				sort: chapter * 1000 + verse,
				division: String(chapter),
				divisionTitle: null,
				text: english,
			});
		}
	}
	return passages.sort((a, b) => a.sort - b.sort);
}

/** The page without its footnote list. */
function beforeNotes(html: string): string {
	const i = html.search(
		/<div[^>]*class="[^"]*(?:reflist|references-small)|<ol class="references"|<h2[^>]*>\s*Footnotes/,
	);
	return i < 0 ? html : html.slice(0, i);
}

/** Wikisource HTML as text: no styles, footnote markers, page numbers, or tags. */
function wikisourceText(html: string): string {
	return clean(
		decodeEntities(
			html
				.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, "")
				.replace(/<sup[^>]*class="reference"[^>]*>[\s\S]*?<\/sup>/g, "")
				.replace(/<span[^>]*class="pagenum[^"]*"[^>]*>[\s\S]*?<\/span><\/span>/g, "")
				.replace(/<[^>]+>/g, " "),
		).replace(/[\u200b\u00a0]/g, " "),
	);
}

/**
 * The Koran (Pickthall, 1930), from Project Gutenberg 16955. That file sets three
 * translations under each "SSS.VVV" number; only the "P:" (Pickthall) text is kept.
 * Verse numbers follow the standard (Cairo) count of 6,236 verses.
 */
export function parsePickthall(raw: string): Passage[] {
	const passages: Passage[] = [];
	for (const m of gutenbergBody(raw).matchAll(
		/^(\d{3})\.(\d{3})\s*\n([\s\S]*?)(?=^\d{3}\.\d{3}\s*$|(?![\s\S]))/gm,
	)) {
		const sura = Number(m[1]);
		const verse = Number(m[2]);
		// Four blocks (17.32, 39.45, 45.31, 56.25) hold a second, unnumbered verse: the next one.
		const ps = [...(m[3] as string).matchAll(/^P:\s*([\s\S]*?)(?=^[A-Z]:|(?![\s\S]))/gm)];
		for (const [k, p] of ps.entries()) {
			const v = verse + k;
			const text = clean(p[1] ?? "");
			if (text)
				passages.push({
					ref: `Quran ${sura}.${v}`,
					sort: sura * 1000 + v,
					division: String(sura),
					divisionTitle: null,
					text,
				});
		}
	}
	return passages;
}

/**
 * Shinto oracles, as Aston quotes them in "Shinto: The Way of the Gods" (1905), chapter 14.
 * Aston prints each oracle in italics after its source ("Oracle of the Gods of Kasuga:—").
 * His own summaries are in roman type and are not kept. He does not number the oracles,
 * so the numbers follow his order.
 */
export function parseAstonOracles(chapterHtml: string): Passage[] {
	const start = chapterHtml.indexOf("Shinto Oracles");
	const end = chapterHtml.indexOf("Revival of Pure Shinto");
	if (start < 0 || end < start) throw new Error("Aston: oracle section not found");
	const section = chapterHtml.slice(start, end);
	const oracles: { title: string; parts: string[] }[] = [];
	let gap = "";
	let last = 0;
	for (const m of section.matchAll(/<i>([\s\S]*?)<\/i>/g)) {
		gap += ` ${wikisourceText(section.slice(last, m.index))}`;
		last = (m.index as number) + m[0].length;
		const italic = wikisourceText(m[1] as string);
		const intro = gap.trim();
		// A name in italics inside an introduction, such as "Oracle of <i>Temman tenjin</i>".
		if (intro && !/(:—|[.!?])$/.test(intro)) {
			gap += ` ${italic}`;
			continue;
		}
		gap = "";
		const current = oracles[oracles.length - 1];
		// A new oracle starts when its source is named. Otherwise the quote continues.
		if (!current || /:—$/.test(intro) || /[Oo]racle of/.test(intro)) {
			oracles.push({ title: oracleTitle(intro), parts: [italic] });
		} else {
			current.parts.push(italic);
		}
	}
	return oracles.map((o, i) => ({
		ref: `Oracle ${i + 1}`,
		sort: i + 1,
		division: "1",
		divisionTitle: o.title,
		text: clean(o.parts.join(" ").replace(/\s+([.!?,;:])/g, "$1")),
	}));
}

function oracleTitle(intro: string): string {
	const sentence = (intro.split(/(?<=[.!?])\s+/).pop() ?? intro).replace(/\s*:—\s*$/, "").trim();
	const named = sentence.match(
		/[Oo]racle of ([^,:(]*?)(?=\s*[,:(]|\s+(?:denounces|promises|enjoins|speaks)|$)/,
	);
	const title = named
		? `Oracle of ${named[1]}`
		: sentence
				.replace(
					/^The following (?:sentiments are ascribed to|poem was revealed in a dream to) /,
					"",
				)
				.replace(
					/^(.*?) received the following inspiration in a dream(?: from (.*))?$/,
					(_, who, from) =>
						from
							? `Dream of ${who.replace(/^The /, "the ")}, from ${from}`
							: `Dream of ${who.replace(/^A /, "a ")}`,
				)
				.replace(/ says$/, "");
	const t = title.replace(/\s+/g, " ").trim();
	return t.charAt(0).toUpperCase() + t.slice(1);
}

const ROMAN_NUMERAL = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/;

/**
 * The Japji (Macauliffe, "The Sikh Religion", 1909, volume 1). Each pauri follows a
 * centered roman numeral; the closing slok follows a centered "SLOK". Japji 0 is the
 * opening (the Mul Mantar), 1 to 38 are the pauris, and 39 is the closing slok.
 */
export function parseJapji(html: string): Passage[] {
	// Pauri XXXIII has its numeral in a plain paragraph, not a centered one.
	const parts = beforeNotes(html).split(
		/(?:<div class="wst-center tiInherit">\s*)?<p>([A-Z]+)\s*<\/p>(?:\s*<\/div>)?/,
	);
	const passages: Passage[] = [];
	const opening = wikisourceText(parts[0] ?? "").replace(/^[\s\S]*?THE JAPJI\s*/, "");
	passages.push({
		ref: "Japji 0",
		sort: 0,
		division: "1",
		divisionTitle: "Mul Mantar",
		text: opening,
	});
	for (let i = 1; i < parts.length; i += 2) {
		const label = parts[i] as string;
		const text = wikisourceText(parts[i + 1] ?? "");
		if (label === "SLOK") {
			passages.push({ ref: "Japji 39", sort: 39, division: "1", divisionTitle: "Slok", text });
			continue;
		}
		if (!ROMAN_NUMERAL.test(label)) throw new Error(`Japji: unexpected heading ${label}`);
		const n = romanToInt(label);
		passages.push({ ref: `Japji ${n}`, sort: n, division: "1", divisionTitle: null, text });
	}
	return passages.map((p) => ({ ...p, text: p.text.replace(/(\w) s (?=\w)/g, "$1's ") }));
}

/**
 * Diogenes Laertius, Lives of Eminent Philosophers, Book 6 (Hicks, 1925, Wikisource).
 * Sections start with a bold "N."; each life starts with a heading.
 */
export function parseHicksBook6(html: string): Passage[] {
	const passages: Passage[] = [];
	let person: string | null = null;
	const tokens = beforeNotes(html).split(/(<h2[^>]*>[\s\S]*?<\/h2>|<b>\d+\.<\/b>)/);
	let current: Passage | null = null;
	for (const t of tokens) {
		const h = t.match(/^<h2[^>]*>([\s\S]*?)<\/h2>$/);
		if (h) {
			person = wikisourceText(h[1] as string);
			continue;
		}
		const n = t.match(/^<b>(\d+)\.<\/b>$/);
		if (n) {
			const section = Number(n[1]);
			current = {
				ref: `DL 6.${section}`,
				sort: 6000 + section,
				division: "6",
				divisionTitle: person,
				text: "",
			};
			passages.push(current);
			continue;
		}
		if (current)
			current.text += ` ${wikisourceText(t.replace(/<span class="mw-editsection">[\s\S]*?<\/span><\/span>/g, ""))}`;
	}
	return passages.map((p) => ({ ...p, text: clean(p.text) }));
}

/**
 * Epictetus, Discourses (Oldfather, 1928, Wikisource), one chapter. Oldfather marks every
 * fifth section in the margin, so each passage covers the sections up to the next mark,
 * such as 3.22.5-9. `lastSection` closes the final range.
 */
export function parseOldfatherChapter(
	html: string,
	book: number,
	chapter: number,
	lastSection: number,
): Passage[] {
	const parts = beforeNotes(html).split(
		/<span class="wst-verse[^"]*" id="(\d+)"><sup>\d+<\/sup><\/span>/,
	);
	const starts = [1];
	const texts = [parts[0] ?? ""];
	for (let i = 1; i < parts.length; i += 2) {
		starts.push(Number(parts[i]));
		texts.push(parts[i + 1] ?? "");
	}
	return starts.map((start, i) => {
		const end = (starts[i + 1] ?? lastSection + 1) - 1;
		let text = wikisourceText(texts[i] as string);
		if (i === 0) text = text.replace(/^[\s\S]*?On the calling of a Cynic\s*/i, "");
		return {
			ref: `Epictetus ${book}.${chapter}.${start}-${end}`,
			sort: book * 100000 + chapter * 1000 + start,
			division: String(book),
			divisionTitle: null,
			subdivision: chapter,
			text,
		};
	});
}

/** The 15 books of the Book of Mormon, in order. Their place in this list is the division number. */
export const BOOK_OF_MORMON_BOOKS = [
	"1 Nephi",
	"2 Nephi",
	"Jacob",
	"Enos",
	"Jarom",
	"Omni",
	"Words of Mormon",
	"Mosiah",
	"Alma",
	"Helaman",
	"3 Nephi",
	"4 Nephi",
	"Mormon",
	"Ether",
	"Moroni",
];

// The heading line that starts each book in Project Gutenberg #17.
const BOM_HEADINGS: Record<string, number> = {
	"THE FIRST BOOK OF NEPHI HIS REIGN AND MINISTRY (1 Nephi)": 1,
	"THE SECOND BOOK OF NEPHI": 2,
	"THE BOOK OF JACOB": 3,
	"THE BOOK OF ENOS": 4,
	"THE BOOK OF JAROM": 5,
	"THE BOOK OF OMNI": 6,
	"THE WORDS OF MORMON": 7,
	"THE BOOK OF MOSIAH": 8,
	"THE BOOK OF ALMA": 9,
	"THE BOOK OF HELAMAN": 10,
	"THIRD BOOK OF NEPHI": 11,
	"FOURTH NEPHI": 12,
	"THE BOOK OF MORMON": 13,
	"THE BOOK OF ETHER": 14,
	"THE BOOK OF MORONI": 15,
};

/**
 * The Book of Mormon (1830 text, Project Gutenberg #17). A verse starts at "3:7", or at "Alma 3:7"
 * inside a paragraph. The introductions of the books and the chapter headings are not kept.
 * A verse out of order stops the build, so a missed marker cannot join two verses in silence.
 */
export function parseBookOfMormon(raw: string): Passage[] {
	const passages: Passage[] = [];
	const names = BOOK_OF_MORMON_BOOKS.join("|");
	const chapterLine = new RegExp(`^(${names}) Chapter (\\d+)$`);
	const marker = new RegExp(`(?:^|\\s)(?:(${names}) )?(\\d+):(\\d+) `, "g");
	let book = 0;
	let last = { book: 0, chapter: 0, verse: 0 };
	for (const block of gutenbergBody(raw).split(/\r?\n\s*\r?\n/)) {
		const para = block.replace(/\s+/g, " ").trim();
		const heading = BOM_HEADINGS[para];
		if (heading) book = heading;
		const chapter = para.match(chapterLine);
		if (chapter) book = BOOK_OF_MORMON_BOOKS.indexOf(chapter[1] as string) + 1;
		if (heading || chapter || !/^(?:[1-4A-Z][A-Za-z ]* )?\d+:\d+ /.test(para)) continue;
		const marks = [...para.matchAll(marker)];
		for (const [k, m] of marks.entries()) {
			if (m[1]) book = BOOK_OF_MORMON_BOOKS.indexOf(m[1]) + 1;
			const c = Number(m[2]);
			const v = Number(m[3]);
			const name = BOOK_OF_MORMON_BOOKS[book - 1] ?? "?";
			const next =
				book === last.book
					? (c === last.chapter && v === last.verse + 1) || (c === last.chapter + 1 && v === 1)
					: book === last.book + 1 && c === 1 && v === 1;
			if (!next) throw new Error(`Book of Mormon: ${name} ${c}:${v} is out of order`);
			last = { book, chapter: c, verse: v };
			const end = marks[k + 1]?.index ?? para.length;
			passages.push({
				ref: `${name} ${c}:${v}`,
				sort: book * 1_000_000 + c * 1000 + v,
				division: String(book),
				divisionTitle: name,
				subdivision: c,
				text: clean(para.slice((m.index ?? 0) + m[0].length, end)),
			});
		}
	}
	return passages;
}

const plainText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " "));

type Verse = { n: number; text: string; lines: number };

/** The verses of a hymn printed as lines of text: "1. text", then lines that go on with it. */
function rigVedaLines(lines: string[]): Verse[] {
	const verses: Verse[] = [];
	let before: string[] = [];
	for (const line of lines) {
		// With lines that wait before any number, the first number can be 2 (verse 1 had none).
		const next = verses.length ? (verses.at(-1) as Verse).n + 1 : before.length ? 2 : 1;
		// "4. text", "4.text", or "4 text" when 4 is the next number. An indented number must be the next.
		// The scan prints some numbers as "6," or "2§" (for "29.").
		const m = /^(\s*)(\d+)(?:(\.)\s*|,\s*|\s+)(\S.*)$/.exec(line.replace(/^(\s*\d)§\s*/, "$19. "));
		const n = Number(m?.[2]);
		if (
			m &&
			(n === next || (n === 1 && !verses.length) || (m[3] && (m[1] as string).length <= 1))
		) {
			// Lines before verse 2 with no number are verse 1. The scan prints that "1" as "I" on some pages.
			if (n === 2 && !verses.length && before.length)
				verses.push({
					n: 1,
					text: before.join(" ").replace(/^\s*I\.?\s+(?=[A-Z]{2})/, ""),
					lines: before.length,
				});
			verses.push({ n, text: m[4] as string, lines: 1 });
			before = [];
		} else if (line.trim()) {
			const last = verses.at(-1);
			if (last) {
				last.text += ` ${line}`;
				last.lines++;
			} else before.push(line);
		}
	}
	return verses;
}

/**
 * The Rig Veda (Griffith 1896, Wikisource), one page for each hymn, keyed "book.hymn". Most pages
 * print the verses as "1. text" lines, in preformatted text or in a paragraph. A proofread page has
 * one stanza for each verse, verse 1 has no number, and the hymn title is in its running head. Notes
 * are not kept. A hymn that Griffith put only in his appendix or in Latin has no verse on its page.
 */
export function parseGriffithRigVeda(htmlByHymn: Record<string, string>): Passage[] {
	const passages: Passage[] = [];
	const keys = Object.keys(htmlByHymn).sort((a, b) => {
		const [ab, ah] = a.split(".").map(Number) as [number, number];
		const [bb, bh] = b.split(".").map(Number) as [number, number];
		return ab - bb || ah - bh;
	});
	for (const key of keys) {
		const [book, hymn] = key.split(".").map(Number) as [number, number];
		let html = (htmlByHymn[key] as string)
			.replace(/<style[\s\S]*?<\/style>/g, "")
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/<sup[^>]*class="reference"[\s\S]*?<\/sup>/g, "")
			.replace(/<ol class="references"[\s\S]*?<\/ol>/g, "");
		// The text starts after the page header, which ends with the translator's name.
		const header = html.indexOf('id="ws-translator"');
		if (header >= 0) html = html.slice(html.indexOf("</div></div>", header));
		const title = /class="wst-rh-cell wst-rh-right">([\s\S]*?)<\/div>/.exec(html);
		const divisionTitle = title
			? clean(plainText(title[1] as string)).replace(/\.$/, "") || null
			: null;
		let verses: Verse[] = [];
		const stanzas = [...html.matchAll(/<div class="ws-poem-stanza"[^>]*>([\s\S]*?)<\/div>/g)];
		if (stanzas.length) {
			for (const [, body] of stanzas) {
				const num = /<span class="ws-poem-versenum">\s*(\d+)/.exec(body as string);
				const text = clean(
					plainText((body as string).replace(/<span class="ws-poem-versenum">[^<]*<\/span>/, "")),
				);
				const lines = (body as string).split('class="ws-poem-line"').length - 1;
				if (text)
					verses.push({ n: num ? Number(num[1]) : (verses.at(-1)?.n ?? 0) + 1, text, lines });
			}
		} else {
			const blocks = [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map((m) => m[1] as string);
			const body = blocks.length
				? blocks.join("\n")
				: [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)]
						.map((m) => (m[1] as string).replace(/<span class="wst-gap[^>]*><\/span>/g, "     "))
						.join("\n")
						.replace(/<br\s*\/?>/g, "\n");
			// Some pages print a link to the errata as escaped text: "&lt;A HREF=...&gt;word&lt;/A&gt;".
			const text = body.replace(/<[^>]+>/g, "").replace(/&lt;\/?a\b[\s\S]*?&gt;/gi, "");
			verses = rigVedaLines(decodeEntities(text).split("\n"));
		}
		// A number between its two neighbors that breaks the count is a misprint ("17, 16, 19").
		for (let i = 1; i < verses.length - 1; i++) {
			const before = (verses[i - 1] as Verse).n;
			if (verses[i]?.n !== before + 1 && verses[i + 1]?.n === before + 2)
				(verses[i] as Verse).n = before + 1;
		}
		const usual =
			[...verses.map((v) => v.lines)].sort((a, b) => a - b)[Math.floor(verses.length / 2)] ?? 1;
		for (const [i, v] of verses.entries()) {
			// A verse twice as long as the others, before a gap of one, holds the next verse: the source
			// left that number out ("RV 10.48.6-7"). A gap after a verse of usual length is a verse
			// that Griffith left out.
			const after = verses[i + 1]?.n;
			const end = after === v.n + 2 && v.lines >= 2 * usual ? v.n + 1 : v.n;
			passages.push({
				ref: `RV ${book}.${hymn}.${v.n}${end > v.n ? `-${end}` : ""}`,
				sort: book * 1_000_000 + hymn * 1000 + v.n,
				division: String(book),
				divisionTitle,
				subdivision: hymn,
				text: rigVedaScan(clean(v.text)),
			});
		}
	}
	return passages;
}

// The scan reads "I" as "1" before a word, and "!" as "1" at the end of a verse.
const rigVedaScan = (s: string) =>
	s.replace(/(?<![\w,.-])1(?= [a-z])/g, "I").replace(/(?<=[a-z]) 1$/, "!");

const lf = (s: string) => s.replace(/\r/g, "");

const SMALL_WORDS = new Set(["a", "an", "and", "of", "or", "the", "to", "in", "on"]);
/** "TO THE SON OF CRONOS, MOST HIGH" gives "To the Son of Cronos, Most High". */
function titleCase(s: string): string {
	return s
		.toLowerCase()
		.replace(/[\p{L}’']+/gu, (w, at: number) =>
			at > 0 && SMALL_WORDS.has(w) && s[at - 1] !== "-" ? w : w[0]?.toUpperCase() + w.slice(1),
		)
		.replace(/[.\s]+$/, "");
}

/** The text between a line that matches `from` and the next line that matches `to`. */
function between(body: string, from: RegExp, to: RegExp): string {
	const start = body.search(from);
	if (start < 0) throw new Error(`No section ${from}`);
	const rest = body.slice(start).replace(/^.*\n/, "");
	const end = rest.search(to);
	return end < 0 ? rest : rest.slice(0, end);
}

// "(ll. 116-138)", "(ll 493-501)", "(l. 6)", and lettered lines such as "(ll. 929a-929t)".
const LINE_MARK = /\(ll?\.? (\d+)[a-z]?(?:-(\d+)[a-z]?)?\)/g;

/**
 * The passages of one poem of Project Gutenberg #348: each starts at its Greek line numbers.
 * The four-digit footnote marks, the gap marks, and the sub-headings are not kept.
 */
function lineBlocks(section: string): { start: number; end: number; text: string }[] {
	const kept = section
		.split(/\n\s*\n/)
		.filter((p) => !/^[\s*]*$/.test(p) && !/^[A-Z][A-Z ,’'—-]+$/.test(p.trim()))
		.join("\n");
	const marks = [...kept.matchAll(LINE_MARK)];
	return marks.map((m, k) => {
		const start = Number(m[1]);
		const text = kept
			.slice((m.index ?? 0) + m[0].length, marks[k + 1]?.index ?? kept.length)
			.replace(/\(\(LACUNA\)\)|\{\[0-9\]\}/g, " ")
			.replace(/\s*\b\d{4}\b/g, "")
			.replace(/_/g, "");
		return { start, end: m[2] ? Number(m[2]) : start, text: clean(text) };
	});
}

const lineRef = (b: { start: number; end: number }) =>
	b.end > b.start ? `${b.start}-${b.end}` : `${b.start}`;

export const HESIOD_POEMS = ["Theogony", "Works and Days"];

/** Hesiod (Evelyn-White, 1914, Project Gutenberg #348): the Theogony and the Works and Days. */
export function parseHesiod(raw: string): Passage[] {
	const body = gutenbergBody(lf(raw));
	const sections = [
		between(body, /^THE THEOGONY$/m, /^THE CATALOGUES OF WOMEN/m),
		between(body, /^HESIOD’S WORKS AND DAYS$/m, /^THE DIVINATION BY BIRDS$/m),
	];
	return sections.flatMap((section, i) =>
		lineBlocks(section).map((b, k) => ({
			ref: `${HESIOD_POEMS[i]} ${lineRef(b)}`,
			sort: (i + 1) * 100_000 + k,
			division: String(i + 1),
			divisionTitle: HESIOD_POEMS[i] as string,
			text: b.text,
		})),
	);
}

/** The Homeric Hymns (Evelyn-White, 1914, Project Gutenberg #348): hymns I to XXXIII. */
export function parseHomericHymns(raw: string): Passage[] {
	const hymns = between(gutenbergBody(lf(raw)), /^THE HOMERIC HYMNS$/m, /^HOMER’S EPIGRAMS/m);
	const heads = [...hymns.matchAll(/^([IVXL]+)\. (TO .+?)(?: \d{4})?$/gm)];
	return heads.flatMap((h, i) => {
		const n = romanToInt(h[1] as string);
		const section = hymns.slice((h.index ?? 0) + h[0].length, heads[i + 1]?.index ?? hymns.length);
		return lineBlocks(section).map((b, k) => ({
			ref: `HH ${n}.${lineRef(b)}`,
			sort: n * 100_000 + k,
			division: String(n),
			divisionTitle: titleCase(h[2] as string),
			text: b.text,
		}));
	});
}

// Each poem of Bellows: the name of its heading, then other spellings after a bar.
export const BELLOWS_POEMS = [
	"Voluspo|Voluspa",
	"Hovamol|Havamal",
	"Vafthruthnismol|Vafthrudnismal",
	"Grimnismol|Grimnismal",
	"Skirnismol|Skirnismal",
	"Harbarthsljoth|Harbardsljod",
	"Hymiskvitha|Hymiskvida",
	"Lokasenna",
	"Thrymskvitha|Thrymskvida",
	"Alvissmol|Alvissmal",
	"Baldrs Draumar",
	"Rigsthula",
	"Hyndluljoth|Hyndluljod",
	"Svipdagsmol|Svipdagsmal",
	"Völundarkvitha|Volundarkvida",
	"Helgakvitha Hjorvarthssonar|Helgakvida Hjorvardssonar",
	"Helgakvitha Hundingsbana I|Helgakvida Hundingsbana I",
	"Helgakvitha Hundingsbana II|Helgakvida Hundingsbana II",
	"Fra Dautha Sinfjotla|Fra Dauda Sinfjotla",
	"Gripisspo|Gripisspa",
	"Reginsmol|Reginsmal",
	"Fafnismol|Fafnismal",
	"Sigrdrifumol|Sigrdrifumal",
	"Brot af Sigurtharkvithu|Brot af Sigurdarkvidu",
	"Guthrunarkvitha I|Gudrunarkvida I",
	"Sigurtharkvitha en Skamma|Sigurdarkvida in Skamma",
	"Helreith Brynhildar|Helreid Brynhildar",
	"Drap Niflunga",
	"Guthrunarkvitha II|Gudrunarkvida II",
	"Guthrunarkvitha III|Gudrunarkvida III",
	"Oddrunargratr",
	"Atlakvitha|Atlakvida",
	"Atlamol|Atlamal",
	"Guthrunarhvot|Gudrunarhvot",
	"Hamthesmol|Hamdismal",
];

const shown = (name: string) => name.split("|")[0] as string;

/** The poem whose name the heading starts with: "GUTHRUNARKVITHA II, EN FORNA" is "Guthrunarkvitha II". */
function eddaPoem(heading: string): number {
	const i = BELLOWS_POEMS.findIndex((name) => {
		const upper = shown(name).toUpperCase();
		return heading.startsWith(upper) && !/\p{L}/u.test(heading[upper.length] ?? "");
	});
	if (i < 0) throw new Error(`Poetic Edda: no poem named ${heading}`);
	return i + 1;
}

/**
 * The Poetic Edda (Bellows, 1923, Project Gutenberg #73533). Each poem has its name, its English
 * title, Bellows's introductory note, a gap of blank lines, the text, and a notes section. A passage
 * is a stanza; the manuscript's prose goes with the stanza that it leads into, and prose after the
 * last stanza goes with that stanza. A poem of prose only numbers its paragraphs from 1.
 */
export function parseBellowsEdda(raw: string): Passage[] {
	const lines = gutenbergBody(lf(raw)).split("\n");
	const passages: Passage[] = [];
	for (let at = 0; at < lines.length; at++) {
		if (!/^INTRODUCTORY NOTE\s*$/.test(lines[at] as string)) continue;
		const above = lines
			.slice(0, at)
			.filter((l) => l.trim())
			.slice(-2);
		const poem = eddaPoem((above[0] as string).trim());
		const title = titleCase((above[1] as string).trim());
		let to = at + 1;
		while (to < lines.length && !/^\s*NOTES?\s*$/.test(lines[to] as string)) to++;
		// The note ends at the last run of 3 blank lines before the first stanza (or before the last
		// text of a poem of prose only): the note itself can hold such a run.
		// A stanza number has at most 3 digits; a year at the start of a line of the note has 4.
		let limit = lines.findIndex((l, i) => i > at && i < to && /^\d{1,3}\.\s/.test(l));
		if (limit < 0) limit = to - 1 - [...lines.slice(at, to)].reverse().findIndex((l) => l.trim());
		let from = at + 1;
		for (let i = at + 1; i + 2 < limit; i++)
			if (lines.slice(i, i + 3).every((l) => !l.trim())) from = i + 3;
		const paras = lines
			.slice(from, to)
			.join("\n")
			.split(/\n\s*\n/)
			.map((p) => p.trim())
			.filter((p) => /\p{Ll}/u.test(p)); // not a heading inside the poem: "I. GROUGALDR"
		const stanzas: { n: number; text: string }[] = [];
		let lead: string[] = [];
		for (const para of paras) {
			const m = para.match(/^(\d{1,3})\.\s+([\s\S]*)$/);
			if (!m) {
				lead.push(para);
				continue;
			}
			stanzas.push({ n: Number(m[1]), text: [...lead, m[2] as string].join(" ") });
			lead = [];
		}
		if (stanzas.length && lead.length)
			(stanzas.at(-1) as { text: string }).text += ` ${lead.join(" ")}`;
		if (!stanzas.length) stanzas.push(...lead.map((text, k) => ({ n: k + 1, text })));
		for (const s of stanzas) {
			passages.push({
				ref: `${shown(BELLOWS_POEMS[poem - 1] as string)} ${s.n}`,
				sort: poem * 1000 + s.n,
				division: String(poem),
				divisionTitle: title,
				text: clean(s.text.replace(/\s*\|\s*/g, " ")),
			});
		}
		at = to;
	}
	return passages;
}

// Chapters whose page holds only the editor's description of them, with no translation.
const BD_DESCRIBED_ONLY = new Set([20, 168, 184]);
// Editor's lines in the text: "is identical with Chapter IX.", a remark in brackets, the end of
// Renouf's part, and the byline of Naville's.
const BD_EDITORIAL =
	/^(is |Identical with |This completes Sir P\.|BY EDOUARD NAVILLE)|^\[[^\]]*\]$/;

/**
 * The Book of the Dead (Renouf and Naville, 1904, Project Gutenberg #69566). A chapter starts at a
 * centered "CHAPTER CXXV." that is not a plate's caption; its rubric is the title, and each paragraph
 * after it is a passage, up to its notes. A chapter with a letter (XXXA, XXXB) or a second part keeps
 * the number of its chapter, and its paragraphs go on with that chapter's count. Plates, footnotes,
 * and the marks of the notes are not kept.
 */
export function parseRenoufBookOfTheDead(raw: string): Passage[] {
	const lines = gutenbergBody(lf(raw)).split("\n");
	const filled = (from: number) => lines.slice(from).find((l) => l.trim()) ?? "";
	const passages: Passage[] = [];
	const count = new Map<number, number>();
	const titles = new Map<number, string>();
	const unmarked = (s: string) =>
		clean(s.replace(/\(\d+\.?\)|\[\d+\]|[_=⁂]/g, " ").replace(/\s+([,.;:!?—])/g, "$1"));
	let chapter = 0;
	let inText = false;
	let inIllustration = false;
	let inPlate = false; // from "PLATE IV." to the next text at the left margin
	let inFootnote = false;
	let rubric: string[] | null = null; // the italic lines right under a heading, while they are read
	let para: string[] = [];
	const flush = () => {
		const text = unmarked(para.join(" "));
		para = [];
		if (!text || !inText || BD_EDITORIAL.test(text)) return;
		if (!/\p{Ll}/u.test(text)) return; // a heading inside the chapter: "HYMN I.", "PART I."
		const n = (count.get(chapter) ?? 0) + 1;
		count.set(chapter, n);
		passages.push({
			ref: `BD ${chapter}.${n}`,
			sort: chapter * 1000 + n,
			division: String(chapter),
			divisionTitle: titles.get(chapter) || `Chapter ${chapter}`,
			text,
		});
	};
	for (const [i, line] of lines.entries()) {
		if (inIllustration) {
			if (/\]\s*$/.test(line)) inIllustration = false;
			continue;
		}
		const heading = line.match(/^ {10,}CHAPTERS? ([IVXLC]+)[AB]?\b/i);
		if (inFootnote && !heading && (!line.trim() || /^ {2,}\S/.test(line))) continue;
		inFootnote = false;
		if (heading) {
			flush();
			const prev =
				lines
					.slice(0, i)
					.filter((l) => l.trim())
					.at(-1) ?? "";
			const caption =
				(inPlate && /BOOK OF THE DEAD/.test(prev)) ||
				/^\s*(\[Illustration|NOTES?\.)/.test(filled(i + 1)) ||
				/note/i.test(line);
			if (caption) continue;
			inPlate = false;
			chapter = romanToInt((heading[1] as string).toUpperCase());
			inText = !BD_DESCRIBED_ONLY.has(chapter);
			rubric = !titles.has(chapter) && /^\s*(\(\d+\.\))?_/.test(filled(i + 1)) ? [] : null;
			continue;
		}
		if (/^\[Illustration/.test(line)) {
			flush();
			inIllustration = !/\]\s*$/.test(line);
			continue;
		}
		if (/^Footnote \d+:/.test(line)) {
			flush();
			inFootnote = true;
			continue;
		}
		if (/^\s*(?:ce )?(?:INTRODUCTORY NOTE|NOTES?)\b[^a-z]*$/.test(line)) {
			flush();
			inText = false;
			continue;
		}
		if (/^PLATE /.test(line)) {
			flush();
			inPlate = true;
			continue;
		}
		if (/^ +BOOK OF THE DEAD\.\s*$|^\s*-{4,}\s*$/.test(line)) {
			flush();
			continue;
		}
		if (!line.trim()) {
			if (rubric?.length) {
				titles.set(chapter, unmarked(rubric.join(" ")));
				rubric = null;
			}
			flush();
			continue;
		}
		if (inPlate) {
			if (/^ {4,}/.test(line)) continue;
			inPlate = false;
		}
		if (rubric) rubric.push(line);
		else para.push(line);
	}
	flush();
	return passages;
}

/**
 * The Aztec hymns (Brinton, Rig Veda Americanus, 1890, Project Gutenberg #14993). Each hymn has the
 * Nahuatl text, a gloss, and then the English: an italic title, the numbered verses, and "_Notes._".
 * Only the English verses are kept. A hymn whose verses do not run from 1 stops the build.
 */
export function parseBrintonHymns(raw: string): Passage[] {
	const body = gutenbergBody(lf(raw));
	const heads = [...body.matchAll(/^([IVXL]+)\. _.+_\s*$/gm)];
	return heads.flatMap((h, i) => {
		const n = romanToInt(h[1] as string);
		const hymn = body.slice((h.index ?? 0) + h[0].length, heads[i + 1]?.index ?? body.length);
		const notes = hymn.search(/^_Notes\._/m);
		if (notes < 0) throw new Error(`Aztec hymn ${n}: no notes heading`);
		const paras = hymn
			.slice(0, notes)
			.split(/\n\s*\n/)
			.map((p) => p.trim())
			.filter(Boolean);
		const verses: string[] = [];
		let k = paras.length - 1;
		for (; k >= 0 && /^\d+\. /.test(paras[k] as string); k--) verses.unshift(paras[k] as string);
		const title = (paras[k] ?? "").match(/^_([\s\S]+?)\.?_$/);
		if (!title) throw new Error(`Aztec hymn ${n}: no English title`);
		return verses.map((v, j) => {
			const m = v.match(/^(\d+)\. ([\s\S]*)$/) as RegExpMatchArray;
			if (Number(m[1]) !== j + 1) throw new Error(`Aztec hymn ${n}: verse ${m[1]} is out of order`);
			return {
				ref: `Aztec Hymn ${n}.${j + 1}`,
				sort: n * 1000 + j + 1,
				division: String(n),
				divisionTitle: clean(title[1] as string),
				text: clean((m[2] as string).replace(/_/g, "")),
			};
		});
	});
}

/**
 * Chuang Tzu (Giles, 1889, Project Gutenberg #59709). The paragraphs have no numbers: they are
 * numbered from 1 in each chapter. Giles's notes are indented one space and can cut a sentence in
 * two; the two parts are joined. A verse that Giles quotes with its source under it, the editor's
 * remarks in brackets, and the index are not kept.
 */
export function parseGilesChuangTzu(raw: string): Passage[] {
	const body = gutenbergBody(lf(raw));
	const end = body.search(/^_INDEX_\s*$/m);
	const text = end < 0 ? body : body.slice(0, end);
	const heads = [...text.matchAll(/^CHAPTER ([IVXL]+)\.\s*\n\s*\n([^\n]+)\n/gm)];
	return heads.flatMap((h, i) => {
		const n = romanToInt(h[1] as string);
		const blocks = text
			.slice((h.index ?? 0) + h[0].length, heads[i + 1]?.index ?? text.length)
			.split(/\n\s*\n/)
			.map((b) => b.replace(/^\n+/, ""))
			.filter((b) => b.trim() && !/^[\s*]+$/.test(b));
		const paras: string[] = [];
		let afterNote = false;
		let lastWasNote = false;
		for (const b of blocks) {
			if (/^ \S/.test(b)) {
				afterNote = true;
				lastWasNote = true;
				continue;
			}
			if (/^ {2,}_.+_ \(.+\)\.\s*$/.test(b)) {
				// A quoted verse and its source: the verse is the last block of the paragraph before.
				paras[paras.length - 1] = (paras.at(-1) as string).replace(/\n\uE000[\s\S]*$/, "");
				continue;
			}
			if (/^ {2,}\S/.test(b)) {
				if (!lastWasNote && paras.length) paras[paras.length - 1] += `\n\uE000${b}`;
				continue;
			}
			const prev = paras.at(-1);
			const cut = afterNote && prev && (!/[.?!"'’”:]$/.test(prev.trim()) || /^[a-z]/.test(b));
			if (cut) paras[paras.length - 1] = `${prev} ${b}`;
			else paras.push(b);
			afterNote = false;
			lastWasNote = false;
		}
		return paras
			.map((p) =>
				clean(
					p
						.replace(/\uE000/g, " ")
						.replace(/\[[^\]]*\]/g, " ")
						.replace(/_/g, ""),
				),
			)
			.filter(Boolean)
			.map((p, k) => ({
				ref: `Zhuangzi ${n}.${k + 1}`,
				sort: n * 1000 + k + 1,
				division: String(n),
				divisionTitle: titleCase(h[2] as string),
				text: p,
			}));
	});
}

type WsBlock = { text: string; verse: boolean; indent: boolean; center: boolean };

/**
 * The text blocks of a Wikisource page, from its first page number to its footnote list: one for
 * each paragraph, line of verse, or heading. A block in smaller type (an editor's note) is left out.
 */
function wsBlocks(html: string): WsBlock[] {
	let h = beforeNotes(html).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, "");
	const first = h.search(/<span[^>]*class="pagenum/);
	if (first > 0) h = h.slice(first);
	// An inline tag can sit inside a word ("Kha<i>nd</i>a"), so it goes with no space.
	h = h
		.replace(/<sup[^>]*class="reference"[^>]*>[\s\S]*?<\/sup>/g, "")
		.replace(/<span[^>]*class="pagenum[^"]*"[^>]*>[\s\S]*?<\/span><\/span>/g, "")
		.replace(/<br\s*\/?>/g, " ")
		.replace(/<\/?(?:i|b|em|strong|span|a|small|big|abbr|u|s|sub|sup|link)\b[^>]*>/g, "");
	const blocks: WsBlock[] = [];
	const open: string[] = []; // the class of each open div, or "dl"
	let buf = "";
	const flush = () => {
		const text = wikisourceText(buf);
		buf = "";
		// A heading of the editor's apparatus: "Footnotes", "Vol. II." (of the printed book).
		if (
			!text ||
			/^(Footnotes|Vol\. [IVX]+\.)$/.test(text) ||
			open.some((c) => /wst-smaller/.test(c))
		)
			return;
		blocks.push({
			text,
			verse: open.some((c) => c === "dl" || /\bpoem\b|wst-block-center/.test(c)),
			indent: open.some((c) => /hanging-indent/.test(c)),
			center: open.some((c) => /wst-center/.test(c)),
		});
	};
	for (const t of h.split(/(<\/?(?:p|div|dl|dd|h[1-6]|li|ol|ul|table|tr|td)\b[^>]*>)/)) {
		const m = t.match(/^<(\/?)(\w+)([^>]*)>$/);
		if (!m) {
			buf += t;
			continue;
		}
		flush();
		const [, close, tag, attrs] = m as unknown as [string, string, string, string];
		if (tag !== "div" && tag !== "dl") continue;
		if (close) open.pop();
		else if (!attrs.endsWith("/"))
			open.push(tag === "dl" ? "dl" : (attrs.match(/class="([^"]*)"/)?.[1] ?? ""));
	}
	flush();
	return blocks;
}

const hasLower = (s: string) => /\p{Ll}/u.test(s);

/**
 * Kojiki (Chamberlain, 1882, Wikisource), one page for each of the 180 sections, keyed by the section
 * number. A passage is a paragraph, numbered in order ("Kojiki 4.2"). The notes of the original, which
 * Chamberlain indents, stay with the paragraph before them. The passages that he gave in Latin stay so.
 */
export function parseChamberlainKojiki(htmlBySection: Record<string, string>): Passage[] {
	const passages: Passage[] = [];
	for (const [key, html] of Object.entries(htmlBySection)) {
		const section = Number(key);
		let title: string | null = null;
		const paras: string[] = [];
		for (const b of wsBlocks(html)) {
			const head = b.text.match(/^\[?\s*Sect\. [IVXLC]+\.\s*—\s*(.+?)\.?\s*\]?$/);
			if (head) {
				title = head[1] as string;
				continue;
			}
			if (!hasLower(b.text) || b.text === "The End.") continue;
			// A note of the original (indented) and a song stay with the paragraph before them.
			if ((b.indent || b.verse) && paras.length) paras[paras.length - 1] += ` ${b.text}`;
			else paras.push(b.text);
		}
		paras.forEach((text, i) => {
			passages.push({
				ref: `Kojiki ${section}.${i + 1}`,
				sort: section * 1000 + i + 1,
				division: String(section),
				divisionTitle: title,
				text: clean(text),
			});
		});
	}
	return passages.sort((a, b) => a.sort - b.sort);
}

export const PROSE_EDDA_PARTS = ["Prologue", "Gylfaginning", "Skáldskaparmál"];

/**
 * The Prose Edda (Brodeur, 1916, Wikisource), one page for each part, keyed by its name. A passage is
 * a paragraph of a chapter ("Gylfaginning 34.2"), numbered in order; a verse stays in the paragraph
 * before it. The Prologue's first chapter has no number.
 */
export function parseBrodeurProseEdda(htmlByPart: Record<string, string>): Passage[] {
	const passages: Passage[] = [];
	for (const [name, html] of Object.entries(htmlByPart)) {
		const part = PROSE_EDDA_PARTS.indexOf(name) + 1;
		if (part === 0) throw new Error(`Prose Edda: no part ${name}`);
		let chapter = name === "Prologue" ? 1 : 0;
		let paras: string[] = [];
		const done = () => {
			paras.forEach((text, i) => {
				passages.push({
					ref: `${name} ${chapter}.${i + 1}`,
					sort: part * 1_000_000 + chapter * 1000 + i + 1,
					division: String(part),
					subdivision: chapter,
					divisionTitle: null,
					text: clean(text),
				});
			});
			paras = [];
		};
		for (const b of wsBlocks(html)) {
			const alone = b.text.match(/^([IVXL]+)\.?$/);
			const lead = b.text.match(/^\[?([IVXL]+)\.\s+([\s\S]*)$/);
			if (alone || lead) {
				done();
				chapter = romanToInt(((alone ?? lead) as RegExpMatchArray)[1] as string);
				if (lead) paras.push(`${b.text.startsWith("[") ? "[" : ""}${lead[2]}`);
				continue;
			}
			if (!hasLower(b.text) || chapter === 0) continue;
			if (b.verse && paras.length) paras[paras.length - 1] += ` ${b.text}`;
			else paras.push(b.text);
		}
		done();
	}
	return passages.sort((a, b) => a.sort - b.sort);
}

export const UPANISHADS = [
	"Khandogya|Chandogya|Chhandogya",
	"Kena|Talavakara",
	"Isa|Isavasya|Vajasaneyi",
];

const ORDINALS =
	"first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth".split(
		" ",
	);
const TENS: Record<string, number> = { twentieth: 20, twenty: 20, thirtieth: 30, thirty: 30 };
/** "Sixth" is 6, "Twenty-fourth" is 24. */
function ordinal(word: string): number {
	const [a, b] = word.toLowerCase().split("-") as [string, string | undefined];
	if (b) return (TENS[a] ?? Number.NaN) + ORDINALS.indexOf(b) + 1;
	return TENS[a] ?? ORDINALS.indexOf(a) + 1;
}

/**
 * The Upanishads of Sacred Books of the East 1 (Müller, 1879, Wikisource): the Khândogya, the Kena
 * (Talavakâra), and the Îsâ (Vâgasaneyi). Pages are keyed "Khandogya 6" (one for each Prapâthaka),
 * "Kena", and "Isa". The Khândogya is cited by Prapâthaka and Khanda, one passage for each Khanda
 * with its verse numbers ("Khandogya 6.8"); the Kena by Khanda and verse ("Kena 1.3"); the Îsâ by verse
 * ("Isa 6", the verse as its subdivision too, so that the ref names it).
 */
export function parseMullerUpanishads(htmlByPage: Record<string, string>): Passage[] {
	const passages: Passage[] = [];
	for (const [key, html] of Object.entries(htmlByPage)) {
		const [name, book] = key.split(" ") as [string, string | undefined];
		const index = UPANISHADS.findIndex((u) => u.startsWith(`${name}|`)) + 1;
		if (index === 0) throw new Error(`Upanishads: no ${name}`);
		let khanda = name === "Isa" ? 1 : 0;
		const verses: { khanda: number; n: number; label: string; text: string }[] = [];
		// The anchor of a Khanda heading holds its number; the heading's word can be misspelled ("Elventh").
		const marked = html.replace(
			/<span id="Khanda(\d+)"[^>]*class="wst-anchor"[^>]*>[\s\S]*?<\/span>/g,
			"\uE004$1\uE004",
		);
		for (const b of wsBlocks(marked)) {
			const anchor = b.text.match(/^\uE004(\d+)\uE004/);
			const head = b.text.match(/^([A-Z][a-z]+(?:-[a-z]+)?) Khanda\.?$/);
			if (anchor || head) {
				khanda = anchor ? Number(anchor[1]) : ordinal((head as RegExpMatchArray)[1] as string);
				continue;
			}
			// "1, 2." is two verses that Müller gives together.
			const v = b.text.match(/^((\d+)(?:,\s*\d+)*)\.\s+([\s\S]*)$/);
			if (v && khanda)
				verses.push({ khanda, n: Number(v[2]), label: v[1] as string, text: v[3] as string });
			else if (verses.length && hasLower(b.text))
				(verses.at(-1) as { text: string }).text += ` ${b.text}`;
		}
		const at = (sub: number, n: number) => index * 1_000_000 + sub * 1000 + n;
		if (name === "Khandogya") {
			const p = Number(book);
			for (const k of [...new Set(verses.map((v) => v.khanda))])
				passages.push({
					ref: `Khandogya ${p}.${k}`,
					sort: at(p, k),
					division: String(index),
					subdivision: p,
					divisionTitle: null,
					text: clean(
						verses
							.filter((v) => v.khanda === k)
							.map((v) => `${v.label}. ${v.text}`)
							.join(" "),
					),
				});
		} else
			for (const v of verses)
				passages.push({
					ref: name === "Isa" ? `Isa ${v.n}` : `${name} ${v.khanda}.${v.n}`,
					sort: name === "Isa" ? at(v.n, v.n) : at(v.khanda, v.n),
					division: String(index),
					subdivision: name === "Isa" ? v.n : v.khanda,
					divisionTitle: null,
					text: clean(v.text),
				});
	}
	return passages.sort((a, b) => a.sort - b.sort);
}

/**
 * The Shû King (Legge, Sacred Books of the East 3, 1879, Wikisource), one page for each book, or for
 * each section of a book with sections, keyed "part.book" or "part.book.section". The pages carry
 * Legge's chapter numbers for some books only, so a passage is a paragraph, numbered in order through
 * the book ("Shu 2.1.3"). His introduction and notes (in smaller type), the headings, and the index page
 * of a book with sections are out.
 */
export function parseLeggeShuKing(htmlByPage: Record<string, string>): Passage[] {
	const passages: Passage[] = [];
	const keys = Object.keys(htmlByPage);
	const ran: Record<string, number> = {}; // paragraphs already numbered in the earlier sections of a book
	const order = (k: string) => k.split(".").map(Number).concat(0) as [number, number, number];
	for (const key of keys.sort((a, b) => {
		const [x, y] = [order(a), order(b)];
		return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
	})) {
		if (keys.some((k) => k.startsWith(`${key}.`))) continue;
		const html = htmlByPage[key] as string;
		const [part, book] = order(key);
		const header = html.match(/class="header-section-text">([\s\S]*?)<\/div>/);
		const title = header
			? wikisourceText(header[1] as string).replace(/^Part [IVX]+, Book [IVXL]+:\s*/, "")
			: null;
		const paras: string[] = [];
		for (const b of wsBlocks(html)) {
			if (b.center || !hasLower(b.text) || /^(Book [IVXL]+\.|Section \d+\.$)/.test(b.text))
				continue;
			const text = b.text.replace(/^\d+\.\s+/, "").replace(/\*\s*/g, " ");
			if (b.verse && paras.length) paras[paras.length - 1] += ` ${text}`;
			else paras.push(text);
		}
		const offset = ran[`${part}.${book}`] ?? 0;
		paras.forEach((text, i) => {
			const n = offset + i + 1;
			passages.push({
				ref: `Shu ${part}.${book}.${n}`,
				sort: part * 1_000_000 + book * 1000 + n,
				division: String(part),
				subdivision: book,
				divisionTitle: title,
				text: clean(text),
			});
		});
		ran[`${part}.${book}`] = offset + paras.length;
	}
	return passages.sort((a, b) => a.sort - b.sort);
}
