// USFM parser tuned for the eBible.org `eng-web` bundle.
//
// USFM is a markup spec used by Paratext for translation projects. We don't
// implement the full grammar — just enough to extract clean per-verse text
// plus the paragraph marker active when each verse appears. The full grammar
// lives at https://ubsicap.github.io/usfm/ but we never need most of it.
//
// What we keep: verse text, chapter number, verse number, paragraph marker,
// USFM book code (from \id line).
// What we drop: footnotes (\f...\f*), cross-references (\x...\x*), embedded
// Hebrew/Greek words (\+wh, \+wg), section headings, TOC entries, main titles,
// introductory matter (preface), and Strong's number wrappers.
// What we keep but unwrap: words of Jesus (\wj), book references (\bk),
// keywords (\k), selah (\qs), divine name (\nd), translator additions (\add),
// italic emphasis (\it), speakers (\sp).

import { osisFromUsfm } from "./bible-canonicalizer.ts";

export type ParsedVerse = {
	bookCode: string; // OSIS, e.g. "Gen"
	chapter: number;
	verse: number;
	text: string;
	paragraphMarker: string | null; // \p, \m, \q1, \q2, \nb, \pi1, etc.
};

export type ParsedBook = {
	bookCode: string; // OSIS
	usfmCode: string; // raw USFM 3-letter code from \id line
	verses: ParsedVerse[];
};

// Paragraph markers we track. Each marks a logical paragraph break in the
// source — Phase 2 will use these to group verses into embedding chunks.
const PARAGRAPH_MARKERS = new Set([
	"p", "m", "mi", "nb", "pi1", "pi2", "pi3", "q1", "q2", "q3", "q4", "qm1", "qm2", "qr",
	"li1", "li2", "ili", "ili1", "ili2", "pc", "pmo", "pm", "pmc", "pmr", "pr", "cls",
]);

// Strip block-level structures that span multiple tokens. Order matters:
// footnotes can contain cross-references can contain embedded scripts.
function stripBlocks(input: string): string {
	let text = input;
	// Footnotes: \f + \fr ref \ft text \f*
	text = text.replace(/\\f\b[\s\S]*?\\f\*/g, "");
	// Cross-references: \x - ... \x*
	text = text.replace(/\\x\b[\s\S]*?\\x\*/g, "");
	// Embedded Hebrew/Greek words inside footnotes (defensive)
	text = text.replace(/\\\+wh\b[\s\S]*?\\\+wh\*/g, "");
	text = text.replace(/\\\+wg\b[\s\S]*?\\\+wg\*/g, "");
	return text;
}

// Strip inline markers that wrap content we want to preserve. Removes the
// markup but keeps the inner text. Strong's wrappers are most common.
//
// USFM uses `\+xxx` for markers nested inside other markers (e.g., `\+w`
// inside `\wj`). We strip the nested form first, since outer-marker patterns
// don't see through `\+` syntax.
function stripInlineMarkers(input: string): string {
	let text = input;
	// Nested Strong's inside other markers: \+w word|strong="X"\+w*
	text = text.replace(/\\\+w\s+([^|\\]+?)(?:\|[^\\]*?)?\\\+w\*/g, "$1");
	// Catch-all for any other nested marker: \+xxx ... \+xxx*
	text = text.replace(/\\\+([a-z]+[0-9]*)\b\s*([\s\S]*?)\\\+\1\*/g, "$2");
	// Top-level Strong's: \w word|strong="H1234"\w* OR \w word\w* (no strong attr)
	text = text.replace(/\\w\s+([^|\\]+?)(?:\|[^\\]*?)?\\w\*/g, "$1");
	// Words of Jesus: \wj text \wj*
	text = text.replace(/\\wj\b\s*([\s\S]*?)\\wj\*/g, "$1");
	// Book reference: \bk Title \bk*
	text = text.replace(/\\bk\b\s*([\s\S]*?)\\bk\*/g, "$1");
	// Keyword: \k word \k*
	text = text.replace(/\\k\b\s*([\s\S]*?)\\k\*/g, "$1");
	// Selah / interjection: \qs text \qs*
	text = text.replace(/\\qs\b\s*([\s\S]*?)\\qs\*/g, "$1");
	// Divine name: \nd LORD \nd*
	text = text.replace(/\\nd\b\s*([\s\S]*?)\\nd\*/g, "$1");
	// Translator addition: \add word \add*
	text = text.replace(/\\add\b\s*([\s\S]*?)\\add\*/g, "$1");
	// Italic: \it text \it*
	text = text.replace(/\\it\b\s*([\s\S]*?)\\it\*/g, "$1");
	// Speaker label: \sp Name (no closing tag — applies to next paragraph)
	text = text.replace(/\\sp\s+[^\n]*/g, "");
	// Ordinal: \ord 1st \ord*
	text = text.replace(/\\ord\b\s*([\s\S]*?)\\ord\*/g, "$1");
	// Catch-all for any remaining \xxx ... \xxx* paired markers we didn't list
	text = text.replace(/\\([a-z]+[0-9]*)\b\s*([\s\S]*?)\\\1\*/g, "$2");
	return text;
}

// Drop markers that should remove their content entirely (front matter,
// TOC, descriptive titles, headings, etc).
function stripMetaLines(input: string): string {
	const dropMarkers = [
		"id", "ide", "h", "toc1", "toc2", "toc3",
		"mt1", "mt2", "mt3", "mt4", "mt", // main title
		"mte1", "mte2", // ending title
		"is1", "is2", "is3", "ip", "ipi", "ipq", "imt1", "imt2", "imte", // intro matter
		"s1", "s2", "s3", "s4", "sr", "sd1", "sd2", // section headings
		"r", // parallel passage reference
		"d", // descriptive title (e.g., Psalm headings)
		"qa", // acrostic heading
		"pb", // page break
	];
	const pattern = new RegExp(`^\\\\(?:${dropMarkers.join("|")})\\b[^\n]*$`, "gm");
	return input.replace(pattern, "");
}

// Drop standalone marker tokens that don't carry content.
function stripStandaloneMarkers(input: string): string {
	let text = input;
	// \b — blank line (paragraph break, but we already track via \p markers)
	text = text.replace(/\\b\b/g, "");
	const noContent = ["fig", "ndx", "pro"]; // figure, index, pronunciation hint
	for (const m of noContent) {
		text = text.replace(new RegExp(`\\\\${m}\\b\\s+[^\\n]*?\\\\${m}\\*`, "g"), "");
	}
	return text;
}

// Normalize whitespace: collapse runs, fix punctuation spacing.
function normalizeText(input: string): string {
	let text = input;
	text = text.replace(/\s+/g, " ");
	text = text.replace(/\s+([,.;:!?])/g, "$1");
	return text.trim();
}

type Token =
	| { kind: "marker"; name: string }
	| { kind: "text"; value: string };

// Tokenize the cleaned USFM into a flat list of markers and text chunks.
// We use String.matchAll which returns an iterable RegExpStringIterator.
function tokenize(text: string): Token[] {
	const tokenPattern = /\\([a-z]+[0-9]*)\b\s*|([^\\]+)/g;
	const tokens: Token[] = [];
	for (const m of text.matchAll(tokenPattern)) {
		const marker = m[1];
		const rawText = m[2];
		if (marker !== undefined) {
			tokens.push({ kind: "marker", name: marker });
		} else if (rawText !== undefined) {
			tokens.push({ kind: "text", value: rawText });
		}
	}
	return tokens;
}

// Parse a USFM file's contents. Returns the book code (OSIS) plus all verses.
export function parseUsfm(content: string): ParsedBook | null {
	// First line should be \id BOOK ... — extract the USFM code.
	const idMatch = content.match(/^\\id\s+([A-Z0-9]+)/m);
	if (!idMatch || !idMatch[1]) return null;
	const usfmCode = idMatch[1];
	const osisCode = osisFromUsfm(usfmCode);
	if (!osisCode) return null;

	// Pre-process: strip block-level structures, meta lines, inline wrappers.
	let text = stripBlocks(content);
	text = stripMetaLines(text);
	text = stripInlineMarkers(text);
	text = stripStandaloneMarkers(text);

	const tokens = tokenize(text);

	const verses: ParsedVerse[] = [];
	let currentChapter = 0;
	let currentVerse = 0;
	let currentMarker: string | null = null;
	let buffer: string[] = [];

	const flushVerse = () => {
		if (currentChapter === 0 || currentVerse === 0) return;
		const verseText = normalizeText(buffer.join(" "));
		if (verseText.length === 0) return;
		verses.push({
			bookCode: osisCode,
			chapter: currentChapter,
			verse: currentVerse,
			text: verseText,
			paragraphMarker: currentMarker,
		});
	};

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i]!;

		if (tok.kind === "marker") {
			if (tok.name === "c") {
				flushVerse();
				buffer = [];
				currentVerse = 0;
				// Next text token contains the chapter number.
				const next = tokens[i + 1];
				if (next?.kind === "text") {
					const num = parseInt(next.value.trim(), 10);
					if (!Number.isNaN(num)) currentChapter = num;
					i++; // consume the number token
				}
				continue;
			}
			if (tok.name === "v") {
				flushVerse();
				buffer = [];
				// Next text token contains "<num> <verse-body>".
				const next = tokens[i + 1];
				if (next?.kind === "text") {
					const trimmed = next.value.trimStart();
					const numMatch = trimmed.match(/^(\d+)(?:[a-z\-]*)\s*([\s\S]*)/);
					if (numMatch && numMatch[1]) {
						currentVerse = parseInt(numMatch[1], 10);
						const body = numMatch[2];
						if (body) buffer.push(body);
					}
					i++; // consume the number+body token
				}
				continue;
			}
			if (PARAGRAPH_MARKERS.has(tok.name)) {
				currentMarker = tok.name;
				continue;
			}
			// Other markers were already stripped or are ignorable.
			continue;
		}

		// text token outside a verse marker — accumulate if we're inside a verse.
		if (currentVerse !== 0) {
			buffer.push(tok.value);
		}
	}

	flushVerse();

	return { bookCode: osisCode, usfmCode, verses };
}
