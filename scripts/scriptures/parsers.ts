// Parsers that turn public domain source files into numbered passages.
// Each passage keeps the source's own wording; only page furniture is removed.

export type Passage = {
	ref: string; // "Dhp 5", "TTC 1.2", "Analects 1.1", "BG 2.47"
	sort: number; // reading order within the corpus
	division: string; // the chapter or book the passage belongs to, for chunking
	divisionTitle: string | null;
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
		const nextParagraph = (current?.p ?? 0) + 1;
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
