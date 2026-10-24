// The words of a Spanish search: lower case, accents folded, so "religion" finds "religión".
// Pure, so the same rules hold in SQL (`normalizedSqlEs`) and in tests.
import { type NormalQuery, type PaperRef, parsePaperRef } from "./search-text.ts";

const QUOTES = /^["“”'‘’«](.*)["“”'‘’»]$/s;
const ACCENTED = "áéíóúüñàèìòù";
const PLAIN = "aeiouunaeiou";
const FOLD = new Map([...ACCENTED].map((c, i) => [c, PLAIN[i] as string]));

/** Lower case, accents and ñ folded, apostrophes gone, "9,881" as "9881", each other mark a space. */
export function normalizeQueryEs(q: string): NormalQuery {
	const trimmed = q.trim();
	const quoted = QUOTES.test(trimmed) && trimmed.length > 2;
	const text = [...trimmed.toLowerCase()]
		.map((c) => FOLD.get(c) ?? c)
		.join("")
		.replace(/['‘’ʼ]/g, "")
		.replace(/([0-9]),(?=[0-9]{3})/g, "$1")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
	return { text, words: text ? text.split(" ") : [], quoted };
}

/** The same rule as `normalizeQueryEs`, in SQL. Only immutable functions, so an index can hold it. */
export const normalizedSqlEs = (column: string) =>
	`(' ' || btrim(regexp_replace(regexp_replace(regexp_replace(translate(lower(${column}), '${ACCENTED}', '${PLAIN}'), '[''‘’ʼ]', '', 'g'), '([0-9]),(?=[0-9]{3})', '\\1', 'g'), '[^a-z0-9]+', ' ', 'g')) || ' ')`;

/** A reference, also after "documento" or "doc." ("Documento 1:0.1"). */
export function parsePaperRefEs(q: string): PaperRef | null {
	return parsePaperRef(q.trim().replace(/^(documento|doc\.?)\s+/i, ""));
}

const CLASS: Record<string, string> = { a: "aáà", e: "eéè", i: "iíì", o: "oóò", u: "uúüù", n: "nñ" };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks each normalized word in the text of the HTML (never inside a tag), with or without its accents. */
export function highlightEs(html: string, words: string[], prefixLast: boolean): string {
	const forms = words.filter(Boolean).map((w, i) => {
		const body = [...w].map((c) => (CLASS[c] ? `[${CLASS[c]}]` : escape(c))).join("");
		return i === words.length - 1 && prefixLast ? `${body}[\\p{L}\\d]*` : body;
	});
	if (forms.length === 0) return html;
	const re = new RegExp(`(?<![\\p{L}\\d])(?:${forms.join("|")})(?![\\p{L}\\d])`, "giu");
	return html
		.split(/(<[^>]*>)/)
		.map((part) => (part.startsWith("<") ? part : part.replace(re, (m) => `<span class=urantia-dev-highlighted>${m}</span>`)))
		.join("");
}
