// The words of a search, as the search reads them: plain lower-case words, a reference to the Papers,
// or the name of another work. Pure, so the same rules hold in SQL (`normalizedSql`) and in tests.
import { resolveBibleBook } from "./bible-canonicalizer.ts";

export type NormalQuery = { text: string; words: string[]; quoted: boolean };

const QUOTES = /^["“”'‘’](.*)["“”'‘’]$/s;

/** Lower case, curly quotes plain, apostrophes gone, "9,881" as "9881", each other mark a space. */
export function normalizeQuery(q: string): NormalQuery {
	const trimmed = q.trim();
	const quoted = QUOTES.test(trimmed) && trimmed.length > 2;
	const text = trimmed
		.toLowerCase()
		.replace(/['‘’ʼ]/g, "")
		.replace(/([0-9]),(?=[0-9]{3})/g, "$1")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
	return { text, words: text ? text.split(" ") : [], quoted };
}

/** The same rule as `normalizeQuery`, in SQL. Only immutable functions, so an index can hold it. */
export const normalizedSql = (column: string) =>
	`(' ' || btrim(regexp_replace(regexp_replace(regexp_replace(lower(${column}), '[''‘’ʼ]', '', 'g'), '([0-9]),(?=[0-9]{3})', '\\1', 'g'), '[^a-z0-9]+', ' ', 'g')) || ' ')`;

/** A tsquery from normalized words: only [a-z0-9], so nothing in it has a meaning in tsquery syntax. */
export function toTsQuery(words: string[], join: "&" | "|", prefixLast: boolean): string {
	if (words.length === 0) return "";
	const parts = [...words];
	if (prefixLast) parts[parts.length - 1] = `${parts[parts.length - 1]}:*`;
	return parts.join(` ${join} `);
}

export type PaperRef = { paperId: string; sectionId?: string; paragraphId?: string };

const unquote = (q: string) => q.trim().replace(QUOTES, "$1").trim();
const isPaper = (n: string) => Number(n) >= 0 && Number(n) <= 196;

/** A whole query that names a paragraph, a section, or a paper of the Papers. */
export function parsePaperRef(q: string): PaperRef | null {
	const s = unquote(q)
		.toLowerCase()
		.replace(/^paper\s+/, "");
	let m =
		s.match(/^(\d{1,3}):(\d{1,2})\.(\d{1,3})$/) ?? s.match(/^(\d{1,3})\.(\d{1,2})\.(\d{1,3})$/);
	if (!m) {
		const global = s.match(/^\d:(\d{1,3})\.(\d{1,2})\.(\d{1,3})$/);
		if (global) m = global;
	}
	if (m) {
		const [, paperId, sectionId, paragraphId] = m as unknown as [string, string, string, string];
		return isPaper(paperId)
			? {
					paperId: String(Number(paperId)),
					sectionId: String(Number(sectionId)),
					paragraphId: String(Number(paragraphId)),
				}
			: null;
	}
	const section = s.match(/^(\d{1,3}):(\d{1,2})\.?$/);
	if (section) {
		const [, paperId, sectionId] = section as unknown as [string, string, string];
		return isPaper(paperId)
			? { paperId: String(Number(paperId)), sectionId: String(Number(sectionId)) }
			: null;
	}
	const paper = s.match(/^(\d{1,3}):?$/);
	if (paper) {
		const [, paperId] = paper as unknown as [string, string];
		return isPaper(paperId) ? { paperId: String(Number(paperId)) } : null;
	}
	return null;
}

export type WorkHint = { work: string; title: string };

// The names a reader gives each work, normalized, and the prefix of its references.
const WORK_NAMES: { work: string; title: string; names: string[]; prefix: string }[] = [
	{ work: "dhammapada", title: "The Dhammapada", names: ["dhammapada"], prefix: "dhp" },
	{
		work: "tao-te-ching",
		title: "The Tao Te Ching",
		names: [
			"tao te ching",
			"tao teh king",
			"taoteching",
			"tao te king",
			"daodejing",
			"dao de jing",
		],
		prefix: "ttc",
	},
	{
		work: "analects",
		title: "The Analects of Confucius",
		names: ["analects", "the analects"],
		prefix: "analects",
	},
	{
		work: "bhagavad-gita",
		title: "The Bhagavad Gita",
		names: ["bhagavad gita", "bhagavadgita", "gita", "bhagavad"],
		prefix: "bg",
	},
	{
		work: "quran",
		title: "The Meaning of the Glorious Koran",
		names: ["koran", "quran", "quran", "qur an", "qur", "the koran"],
		prefix: "quran",
	},
	{
		work: "epictetus-cynic",
		title: "Discourses 3.22: On the Calling of a Cynic",
		names: ["epictetus", "discourses"],
		prefix: "epictetus",
	},
	{
		work: "diogenes-laertius-6",
		title: "Lives of Eminent Philosophers, Book 6: The Cynics",
		names: ["diogenes laertius", "laertius", "lives of eminent philosophers"],
		prefix: "dl",
	},
	{
		work: "shinto-oracles",
		title: "Shinto Oracles",
		names: ["shinto oracles", "shinto"],
		prefix: "oracle",
	},
	{ work: "japji", title: "The Japji", names: ["japji", "japji sahib", "japuji"], prefix: "japji" },
];

/** The other work that a query names, by its name or one of its references. */
export function workHint(q: string): WorkHint | null {
	const { text } = normalizeQuery(q);
	if (!text) return null;
	if (text === "bible" || text === "the bible") return { work: "bible", title: "The Bible" };
	for (const w of WORK_NAMES) {
		if (w.names.includes(text)) return { work: w.work, title: w.title };
		if (new RegExp(`^${w.prefix} \\d`).test(text)) return { work: w.work, title: w.title };
	}
	// A Bible reference needs a chapter: "john" alone is a name in the Papers too.
	const bible = unquote(q).match(
		/^((?:[1-4]\s?)?[a-z][a-z .]*?)\s+(\d{1,3})(?::\d{1,3}(?:-\d{1,3})?)?$/i,
	);
	if (bible && resolveBibleBook((bible[1] as string).trim()))
		return { work: "bible", title: "The Bible" };
	return null;
}
