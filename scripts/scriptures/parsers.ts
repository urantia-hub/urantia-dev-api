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
	const parts = beforeNotes(html).split(
		/<div class="wst-center tiInherit">\s*<p>([A-Z]+)\s*<\/p>\s*<\/div>/,
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
