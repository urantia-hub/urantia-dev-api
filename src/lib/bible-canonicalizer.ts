// Canonical book table for the World English Bible (eng-web), 81 books.
//
// Each row maps a book to its OSIS code (used in the API surface), USFM code
// (used in the source files), display name, full title, short abbreviation,
// canonical order (1..81 across OT → Deuterocanon → NT), and canon flag.
//
// OSIS codes follow the CrossWire convention: https://wiki.crosswire.org/OSIS_Book_Abbreviations
// USFM codes follow Paratext: https://ubsicap.github.io/usfm/identification/books.html
//
// Notes on the WEB ecumenical edition:
// - Greek Esther (ESG) and Daniel (Greek, DAG) are separate books from
//   their Hebrew counterparts. DanGr embeds Prayer of Azariah, Susanna,
//   and Bel and the Dragon in context (no separate book entries).
// - Baruch (BAR) includes the Letter of Jeremiah as chapter 6.
// - WEB's ordering of deuterocanonical books matches the front-matter list.

export type Canon = "ot" | "deuterocanon" | "nt";

export type BibleBookMeta = {
	osis: string;
	usfm: string;
	name: string;
	fullName: string;
	abbr: string;
	order: number;
	canon: Canon;
};

export const BIBLE_BOOKS: ReadonlyArray<BibleBookMeta> = [
	// --- Old Testament (39) ---
	{ osis: "Gen", usfm: "GEN", name: "Genesis", fullName: "The First Book of Moses, Commonly Called Genesis", abbr: "Gen", order: 1, canon: "ot" },
	{ osis: "Exod", usfm: "EXO", name: "Exodus", fullName: "The Second Book of Moses, Commonly Called Exodus", abbr: "Exod", order: 2, canon: "ot" },
	{ osis: "Lev", usfm: "LEV", name: "Leviticus", fullName: "The Third Book of Moses, Commonly Called Leviticus", abbr: "Lev", order: 3, canon: "ot" },
	{ osis: "Num", usfm: "NUM", name: "Numbers", fullName: "The Fourth Book of Moses, Commonly Called Numbers", abbr: "Num", order: 4, canon: "ot" },
	{ osis: "Deut", usfm: "DEU", name: "Deuteronomy", fullName: "The Fifth Book of Moses, Commonly Called Deuteronomy", abbr: "Deut", order: 5, canon: "ot" },
	{ osis: "Josh", usfm: "JOS", name: "Joshua", fullName: "The Book of Joshua", abbr: "Josh", order: 6, canon: "ot" },
	{ osis: "Judg", usfm: "JDG", name: "Judges", fullName: "The Book of Judges", abbr: "Judg", order: 7, canon: "ot" },
	{ osis: "Ruth", usfm: "RUT", name: "Ruth", fullName: "The Book of Ruth", abbr: "Ruth", order: 8, canon: "ot" },
	{ osis: "1Sam", usfm: "1SA", name: "1 Samuel", fullName: "The First Book of Samuel", abbr: "1 Sam", order: 9, canon: "ot" },
	{ osis: "2Sam", usfm: "2SA", name: "2 Samuel", fullName: "The Second Book of Samuel", abbr: "2 Sam", order: 10, canon: "ot" },
	{ osis: "1Kgs", usfm: "1KI", name: "1 Kings", fullName: "The First Book of Kings", abbr: "1 Kgs", order: 11, canon: "ot" },
	{ osis: "2Kgs", usfm: "2KI", name: "2 Kings", fullName: "The Second Book of Kings", abbr: "2 Kgs", order: 12, canon: "ot" },
	{ osis: "1Chr", usfm: "1CH", name: "1 Chronicles", fullName: "The First Book of Chronicles", abbr: "1 Chr", order: 13, canon: "ot" },
	{ osis: "2Chr", usfm: "2CH", name: "2 Chronicles", fullName: "The Second Book of Chronicles", abbr: "2 Chr", order: 14, canon: "ot" },
	{ osis: "Ezra", usfm: "EZR", name: "Ezra", fullName: "The Book of Ezra", abbr: "Ezra", order: 15, canon: "ot" },
	{ osis: "Neh", usfm: "NEH", name: "Nehemiah", fullName: "The Book of Nehemiah", abbr: "Neh", order: 16, canon: "ot" },
	{ osis: "Esth", usfm: "EST", name: "Esther", fullName: "The Book of Esther", abbr: "Esth", order: 17, canon: "ot" },
	{ osis: "Job", usfm: "JOB", name: "Job", fullName: "The Book of Job", abbr: "Job", order: 18, canon: "ot" },
	{ osis: "Ps", usfm: "PSA", name: "Psalms", fullName: "The Book of Psalms", abbr: "Ps", order: 19, canon: "ot" },
	{ osis: "Prov", usfm: "PRO", name: "Proverbs", fullName: "The Proverbs", abbr: "Prov", order: 20, canon: "ot" },
	{ osis: "Eccl", usfm: "ECC", name: "Ecclesiastes", fullName: "Ecclesiastes, or, the Preacher", abbr: "Eccl", order: 21, canon: "ot" },
	{ osis: "Song", usfm: "SNG", name: "Song of Solomon", fullName: "The Song of Solomon", abbr: "Song", order: 22, canon: "ot" },
	{ osis: "Isa", usfm: "ISA", name: "Isaiah", fullName: "The Book of Isaiah", abbr: "Isa", order: 23, canon: "ot" },
	{ osis: "Jer", usfm: "JER", name: "Jeremiah", fullName: "The Book of Jeremiah", abbr: "Jer", order: 24, canon: "ot" },
	{ osis: "Lam", usfm: "LAM", name: "Lamentations", fullName: "The Lamentations of Jeremiah", abbr: "Lam", order: 25, canon: "ot" },
	{ osis: "Ezek", usfm: "EZK", name: "Ezekiel", fullName: "The Book of Ezekiel", abbr: "Ezek", order: 26, canon: "ot" },
	{ osis: "Dan", usfm: "DAN", name: "Daniel", fullName: "The Book of Daniel", abbr: "Dan", order: 27, canon: "ot" },
	{ osis: "Hos", usfm: "HOS", name: "Hosea", fullName: "The Book of Hosea", abbr: "Hos", order: 28, canon: "ot" },
	{ osis: "Joel", usfm: "JOL", name: "Joel", fullName: "The Book of Joel", abbr: "Joel", order: 29, canon: "ot" },
	{ osis: "Amos", usfm: "AMO", name: "Amos", fullName: "The Book of Amos", abbr: "Amos", order: 30, canon: "ot" },
	{ osis: "Obad", usfm: "OBA", name: "Obadiah", fullName: "The Book of Obadiah", abbr: "Obad", order: 31, canon: "ot" },
	{ osis: "Jonah", usfm: "JON", name: "Jonah", fullName: "The Book of Jonah", abbr: "Jonah", order: 32, canon: "ot" },
	{ osis: "Mic", usfm: "MIC", name: "Micah", fullName: "The Book of Micah", abbr: "Mic", order: 33, canon: "ot" },
	{ osis: "Nah", usfm: "NAM", name: "Nahum", fullName: "The Book of Nahum", abbr: "Nah", order: 34, canon: "ot" },
	{ osis: "Hab", usfm: "HAB", name: "Habakkuk", fullName: "The Book of Habakkuk", abbr: "Hab", order: 35, canon: "ot" },
	{ osis: "Zeph", usfm: "ZEP", name: "Zephaniah", fullName: "The Book of Zephaniah", abbr: "Zeph", order: 36, canon: "ot" },
	{ osis: "Hag", usfm: "HAG", name: "Haggai", fullName: "The Book of Haggai", abbr: "Hag", order: 37, canon: "ot" },
	{ osis: "Zech", usfm: "ZEC", name: "Zechariah", fullName: "The Book of Zechariah", abbr: "Zech", order: 38, canon: "ot" },
	{ osis: "Mal", usfm: "MAL", name: "Malachi", fullName: "The Book of Malachi", abbr: "Mal", order: 39, canon: "ot" },

	// --- Deuterocanon (15) ---
	// Order matches the WEB ecumenical front-matter listing.
	{ osis: "Tob", usfm: "TOB", name: "Tobit", fullName: "The Book of Tobit", abbr: "Tob", order: 40, canon: "deuterocanon" },
	{ osis: "Jdt", usfm: "JDT", name: "Judith", fullName: "The Book of Judith", abbr: "Jdt", order: 41, canon: "deuterocanon" },
	{ osis: "EsthGr", usfm: "ESG", name: "Esther (Greek)", fullName: "Esther from the Greek Septuagint", abbr: "Esth Gr", order: 42, canon: "deuterocanon" },
	{ osis: "Wis", usfm: "WIS", name: "Wisdom of Solomon", fullName: "The Wisdom of Solomon", abbr: "Wis", order: 43, canon: "deuterocanon" },
	{ osis: "Sir", usfm: "SIR", name: "Sirach", fullName: "Ecclesiasticus, or The Wisdom of Jesus Son of Sirach", abbr: "Sir", order: 44, canon: "deuterocanon" },
	{ osis: "Bar", usfm: "BAR", name: "Baruch", fullName: "The Book of Baruch (with the Letter of Jeremiah as chapter 6)", abbr: "Bar", order: 45, canon: "deuterocanon" },
	{ osis: "DanGr", usfm: "DAG", name: "Daniel (Greek)", fullName: "Daniel (Greek), with Prayer of Azariah, Susanna, and Bel and the Dragon", abbr: "Dan Gr", order: 46, canon: "deuterocanon" },
	{ osis: "1Macc", usfm: "1MA", name: "1 Maccabees", fullName: "The First Book of Maccabees", abbr: "1 Macc", order: 47, canon: "deuterocanon" },
	{ osis: "2Macc", usfm: "2MA", name: "2 Maccabees", fullName: "The Second Book of Maccabees", abbr: "2 Macc", order: 48, canon: "deuterocanon" },
	{ osis: "1Esd", usfm: "1ES", name: "1 Esdras", fullName: "The First Book of Esdras", abbr: "1 Esd", order: 49, canon: "deuterocanon" },
	{ osis: "PrMan", usfm: "MAN", name: "Prayer of Manasseh", fullName: "The Prayer of Manasseh", abbr: "Pr Man", order: 50, canon: "deuterocanon" },
	{ osis: "AddPs", usfm: "PS2", name: "Psalm 151", fullName: "Psalm 151 (Additional)", abbr: "Ps 151", order: 51, canon: "deuterocanon" },
	{ osis: "3Macc", usfm: "3MA", name: "3 Maccabees", fullName: "The Third Book of Maccabees", abbr: "3 Macc", order: 52, canon: "deuterocanon" },
	{ osis: "2Esd", usfm: "2ES", name: "2 Esdras", fullName: "The Second Book of Esdras", abbr: "2 Esd", order: 53, canon: "deuterocanon" },
	{ osis: "4Macc", usfm: "4MA", name: "4 Maccabees", fullName: "The Fourth Book of Maccabees", abbr: "4 Macc", order: 54, canon: "deuterocanon" },

	// --- New Testament (27) ---
	{ osis: "Matt", usfm: "MAT", name: "Matthew", fullName: "The Gospel According to Matthew", abbr: "Matt", order: 55, canon: "nt" },
	{ osis: "Mark", usfm: "MRK", name: "Mark", fullName: "The Gospel According to Mark", abbr: "Mark", order: 56, canon: "nt" },
	{ osis: "Luke", usfm: "LUK", name: "Luke", fullName: "The Gospel According to Luke", abbr: "Luke", order: 57, canon: "nt" },
	{ osis: "John", usfm: "JHN", name: "John", fullName: "The Gospel According to John", abbr: "John", order: 58, canon: "nt" },
	{ osis: "Acts", usfm: "ACT", name: "Acts", fullName: "The Acts of the Apostles", abbr: "Acts", order: 59, canon: "nt" },
	{ osis: "Rom", usfm: "ROM", name: "Romans", fullName: "Paul's Letter to the Romans", abbr: "Rom", order: 60, canon: "nt" },
	{ osis: "1Cor", usfm: "1CO", name: "1 Corinthians", fullName: "Paul's First Letter to the Corinthians", abbr: "1 Cor", order: 61, canon: "nt" },
	{ osis: "2Cor", usfm: "2CO", name: "2 Corinthians", fullName: "Paul's Second Letter to the Corinthians", abbr: "2 Cor", order: 62, canon: "nt" },
	{ osis: "Gal", usfm: "GAL", name: "Galatians", fullName: "Paul's Letter to the Galatians", abbr: "Gal", order: 63, canon: "nt" },
	{ osis: "Eph", usfm: "EPH", name: "Ephesians", fullName: "Paul's Letter to the Ephesians", abbr: "Eph", order: 64, canon: "nt" },
	{ osis: "Phil", usfm: "PHP", name: "Philippians", fullName: "Paul's Letter to the Philippians", abbr: "Phil", order: 65, canon: "nt" },
	{ osis: "Col", usfm: "COL", name: "Colossians", fullName: "Paul's Letter to the Colossians", abbr: "Col", order: 66, canon: "nt" },
	{ osis: "1Thess", usfm: "1TH", name: "1 Thessalonians", fullName: "Paul's First Letter to the Thessalonians", abbr: "1 Thess", order: 67, canon: "nt" },
	{ osis: "2Thess", usfm: "2TH", name: "2 Thessalonians", fullName: "Paul's Second Letter to the Thessalonians", abbr: "2 Thess", order: 68, canon: "nt" },
	{ osis: "1Tim", usfm: "1TI", name: "1 Timothy", fullName: "Paul's First Letter to Timothy", abbr: "1 Tim", order: 69, canon: "nt" },
	{ osis: "2Tim", usfm: "2TI", name: "2 Timothy", fullName: "Paul's Second Letter to Timothy", abbr: "2 Tim", order: 70, canon: "nt" },
	{ osis: "Titus", usfm: "TIT", name: "Titus", fullName: "Paul's Letter to Titus", abbr: "Titus", order: 71, canon: "nt" },
	{ osis: "Phlm", usfm: "PHM", name: "Philemon", fullName: "Paul's Letter to Philemon", abbr: "Phlm", order: 72, canon: "nt" },
	{ osis: "Heb", usfm: "HEB", name: "Hebrews", fullName: "The Letter to the Hebrews", abbr: "Heb", order: 73, canon: "nt" },
	{ osis: "Jas", usfm: "JAS", name: "James", fullName: "The Letter from James", abbr: "Jas", order: 74, canon: "nt" },
	{ osis: "1Pet", usfm: "1PE", name: "1 Peter", fullName: "Peter's First Letter", abbr: "1 Pet", order: 75, canon: "nt" },
	{ osis: "2Pet", usfm: "2PE", name: "2 Peter", fullName: "Peter's Second Letter", abbr: "2 Pet", order: 76, canon: "nt" },
	{ osis: "1John", usfm: "1JN", name: "1 John", fullName: "John's First Letter", abbr: "1 John", order: 77, canon: "nt" },
	{ osis: "2John", usfm: "2JN", name: "2 John", fullName: "John's Second Letter", abbr: "2 John", order: 78, canon: "nt" },
	{ osis: "3John", usfm: "3JN", name: "3 John", fullName: "John's Third Letter", abbr: "3 John", order: 79, canon: "nt" },
	{ osis: "Jude", usfm: "JUD", name: "Jude", fullName: "The Letter from Jude", abbr: "Jude", order: 80, canon: "nt" },
	{ osis: "Rev", usfm: "REV", name: "Revelation", fullName: "The Revelation to John", abbr: "Rev", order: 81, canon: "nt" },
];

// Normalize a user-supplied book key for matching. Lowercases, strips
// whitespace, hyphens, underscores, and dots. "1 Macc" → "1macc".
function normalizeKey(input: string): string {
	return input.toLowerCase().replace(/[\s\-_.]/g, "");
}

// Common alternate names readers/agents may pass. Maps to OSIS code.
// Keys are pre-normalized (lowercase, no separators).
const ALIASES: ReadonlyMap<string, string> = new Map([
	// OT alternates
	["1samuel", "1Sam"], ["i samuel", "1Sam"], ["1kingdoms", "1Sam"],
	["2samuel", "2Sam"], ["ii samuel", "2Sam"], ["2kingdoms", "2Sam"],
	["1kings", "1Kgs"], ["i kings", "1Kgs"], ["3kingdoms", "1Kgs"],
	["2kings", "2Kgs"], ["ii kings", "2Kgs"], ["4kingdoms", "2Kgs"],
	["1chronicles", "1Chr"], ["i chronicles", "1Chr"],
	["2chronicles", "2Chr"], ["ii chronicles", "2Chr"],
	["psalm", "Ps"], ["psalms", "Ps"],
	["proverbs", "Prov"],
	["ecclesiastes", "Eccl"], ["qoheleth", "Eccl"],
	["songofsongs", "Song"], ["canticleofcanticles", "Song"], ["canticles", "Song"],
	["isaiah", "Isa"],
	["jeremiah", "Jer"],
	["lamentations", "Lam"],
	["ezekiel", "Ezek"],
	["daniel", "Dan"],
	["hosea", "Hos"],
	["amos", "Amos"],
	["obadiah", "Obad"],
	["jonah", "Jonah"],
	["micah", "Mic"],
	["nahum", "Nah"],
	["habakkuk", "Hab"],
	["zephaniah", "Zeph"],
	["haggai", "Hag"],
	["zechariah", "Zech"],
	["malachi", "Mal"],
	// Deuterocanon alternates
	["tobit", "Tob"],
	["judith", "Jdt"],
	["greekesther", "EsthGr"], ["estheradditions", "EsthGr"], ["additionstoesther", "EsthGr"],
	["wisdom", "Wis"], ["wisdomofsolomon", "Wis"],
	["sirach", "Sir"], ["ecclesiasticus", "Sir"], ["bensira", "Sir"],
	["baruch", "Bar"],
	["letterofjeremiah", "Bar"], ["epistleofjeremiah", "Bar"], ["epjer", "Bar"], // EpJer is part of Baruch ch 6
	["greekdaniel", "DanGr"], ["danieladditions", "DanGr"], ["additionstodaniel", "DanGr"],
	["prayerofazariah", "DanGr"], ["azariah", "DanGr"], // embedded in DanGr
	["susanna", "DanGr"], // embedded in DanGr
	["belandthedragon", "DanGr"], ["bel", "DanGr"], // embedded in DanGr
	["1maccabees", "1Macc"], ["i maccabees", "1Macc"], ["1mac", "1Macc"],
	["2maccabees", "2Macc"], ["ii maccabees", "2Macc"], ["2mac", "2Macc"],
	["3maccabees", "3Macc"], ["iii maccabees", "3Macc"], ["3mac", "3Macc"],
	["4maccabees", "4Macc"], ["iv maccabees", "4Macc"], ["4mac", "4Macc"],
	["1esdras", "1Esd"], ["i esdras", "1Esd"], ["3esdras", "1Esd"],
	["2esdras", "2Esd"], ["ii esdras", "2Esd"], ["4esdras", "2Esd"], ["3ezra", "2Esd"],
	["prayerofmanasseh", "PrMan"], ["manasseh", "PrMan"], ["man", "PrMan"],
	["psalm151", "AddPs"], ["ps151", "AddPs"],
	// NT alternates
	["matthew", "Matt"],
	["mark", "Mark"],
	["luke", "Luke"],
	["john", "John"],
	["actsoftheapostles", "Acts"],
	["romans", "Rom"],
	["1corinthians", "1Cor"], ["i corinthians", "1Cor"],
	["2corinthians", "2Cor"], ["ii corinthians", "2Cor"],
	["galatians", "Gal"],
	["ephesians", "Eph"],
	["philippians", "Phil"], ["philip", "Phil"],
	["colossians", "Col"],
	["1thessalonians", "1Thess"], ["i thessalonians", "1Thess"], ["1thes", "1Thess"],
	["2thessalonians", "2Thess"], ["ii thessalonians", "2Thess"], ["2thes", "2Thess"],
	["1timothy", "1Tim"], ["i timothy", "1Tim"],
	["2timothy", "2Tim"], ["ii timothy", "2Tim"],
	["titus", "Titus"],
	["philemon", "Phlm"],
	["hebrews", "Heb"],
	["james", "Jas"],
	["1peter", "1Pet"], ["i peter", "1Pet"],
	["2peter", "2Pet"], ["ii peter", "2Pet"],
	["1john", "1John"], ["i john", "1John"],
	["2john", "2John"], ["ii john", "2John"],
	["3john", "3John"], ["iii john", "3John"],
	["jude", "Jude"],
	["revelation", "Rev"], ["apocalypse", "Rev"], ["revelationofjohn", "Rev"],
]);

// Build lookup maps once at module load.
const byOsis = new Map<string, BibleBookMeta>();
const byUsfm = new Map<string, BibleBookMeta>();
const byName = new Map<string, BibleBookMeta>();
const byAbbr = new Map<string, BibleBookMeta>();
const byAlias = new Map<string, BibleBookMeta>();

for (const book of BIBLE_BOOKS) {
	byOsis.set(normalizeKey(book.osis), book);
	byUsfm.set(normalizeKey(book.usfm), book);
	byName.set(normalizeKey(book.name), book);
	byAbbr.set(normalizeKey(book.abbr), book);
}
for (const [aliasKey, osisCode] of ALIASES) {
	const target = byOsis.get(normalizeKey(osisCode));
	if (target) {
		byAlias.set(normalizeKey(aliasKey), target);
	}
}

// Resolve any user-supplied book reference to its canonical metadata.
// Tries OSIS, USFM, name, abbreviation, then alias map. Returns null on miss.
export function resolveBibleBook(input: string): BibleBookMeta | null {
	if (!input) return null;
	const k = normalizeKey(input);
	return (
		byOsis.get(k) ?? byUsfm.get(k) ?? byName.get(k) ?? byAbbr.get(k) ?? byAlias.get(k) ?? null
	);
}

// Convert a USFM 3-letter code (from a `\id` line in a .usfm file) to the
// OSIS code we use throughout the API. Returns null if not recognized.
export function osisFromUsfm(usfm: string): string | null {
	const meta = byUsfm.get(normalizeKey(usfm));
	return meta?.osis ?? null;
}

// Format a verse reference for display: ("Gen", 1, 1) → "Genesis 1:1".
// If verse is omitted, returns "Genesis 1". Returns null for unknown books.
export function formatBibleReference(
	osis: string,
	chapter: number,
	verse?: number,
): string | null {
	const meta = byOsis.get(normalizeKey(osis));
	if (!meta) return null;
	return verse === undefined
		? `${meta.name} ${chapter}`
		: `${meta.name} ${chapter}:${verse}`;
}

// Build the OSIS verse id used as the primary key in bible_verses.
// (osis, 1, 1) → "Gen.1.1"
export function bibleVerseId(osis: string, chapter: number, verse: number): string {
	return `${osis}.${chapter}.${verse}`;
}
