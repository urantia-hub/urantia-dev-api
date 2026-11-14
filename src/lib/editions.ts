// The editions of the English text, and the text of a paragraph in each. The stored text is the
// newest edition; an older one undoes the variants after its year (data/editions/variants.json).
import rows from "../../data/editions/variants.json";
import { detectRefFormat } from "../types/node.ts";

export type VariantKind = "text" | "format" | "printing";

export type Variant = {
	ref: string;
	/** The year of the committee report that adopted it; null when no report lists it. */
	year: number | null;
	/** text: words or punctuation. format: italics only. printing: a fault of the printed 1955 book. */
	kind: VariantKind;
	before: string;
	after: string;
	/** False when the Foundation lists the change but its download still has the 1955 wording. */
	inStoredText: boolean;
	/** The Foundation list and committee report; both null for a change that no list records. */
	source: { list: string | null; report: string | null };
	/** "scan": found by the check against the 1955 page photos, not in a Foundation list. */
	foundBy?: "scan";
	page1955: string | null;
	reason: string | null;
	note?: string;
};

export type Edition = {
	id: string;
	label: string;
	/** The year of the text: 1955, or the year of the committee's last corrections in it. */
	year: number;
	/** The Foundation's number for its download of this edition, when a Foundation file shows it. */
	foundationVersion: string | null;
	versionStamp: string | null;
};

export const EDITIONS: readonly Edition[] = [
	{
		id: "1955",
		label: "First printing (1955)",
		year: 1955,
		foundationVersion: null,
		versionStamp: null,
	},
	{
		id: "srt-2009",
		label: "Standard Reference Text, 2009",
		year: 2009,
		foundationVersion: null,
		versionStamp: null,
	},
	{
		id: "srt-2015",
		label: "Standard Reference Text, 2015",
		year: 2015,
		foundationVersion: null,
		versionStamp: null,
	},
	{
		id: "srt-2018",
		label: "Standard Reference Text, 2018",
		year: 2018,
		foundationVersion: null,
		versionStamp: null,
	},
	{
		id: "srt-2021",
		label: "Standard Reference Text, 2021",
		year: 2021,
		foundationVersion: "21",
		versionStamp: "UF-202303081751",
	},
	{
		id: "srt-2024",
		label: "Standard Reference Text, 2024",
		year: 2024,
		foundationVersion: "1.22",
		versionStamp: "UF-202412132348",
	},
];

/** The edition that the API stores and serves by default. */
export const DEFAULT_EDITION = "srt-2024";

export const VARIANTS = rows as Variant[];

/** The edition of a year id ("srt-2021"), a Foundation number ("1.22"), or a version stamp. */
export function resolveEdition(id: string): Edition | undefined {
	const key = id.trim().toLowerCase();
	return EDITIONS.find(
		(e) =>
			e.id === key ||
			(e.foundationVersion !== null && e.foundationVersion === key) ||
			(e.versionStamp !== null && e.versionStamp.toLowerCase() === key),
	);
}

const byRef = new Map<string, Variant[]>();
for (const v of VARIANTS) byRef.set(v.ref, [...(byRef.get(v.ref) ?? []), v]);

/** The variants of one paragraph, in the order of the Foundation's list. */
export function variantsOf(ref: string): Variant[] {
	return byRef.get(ref) ?? [];
}

// A row with no report year is in every SRT, so only the 1955 edition undoes it.
const yearOf = (v: Variant) => v.year ?? 2009;

/** The variants that make the stored text differ from an edition: text rows after its year. */
export function undoneIn(ref: string, edition: Edition): Variant[] {
	return variantsOf(ref).filter(
		(v) => v.kind === "text" && v.inStoredText && yearOf(v) > edition.year,
	);
}

/** The plain text of a paragraph in an edition, made from the stored (newest) text. */
export function textInEdition(ref: string, stored: string, edition: Edition): string {
	const undo = undoneIn(ref, edition)
		.map((v, i) => ({ v, i }))
		.sort((a, b) => yearOf(b.v) - yearOf(a.v) || b.i - a.i);
	let text = stored;
	for (const { v } of undo) {
		const at = text.indexOf(v.after);
		if (at < 0 || text.indexOf(v.after, at + 1) >= 0) {
			throw new Error(`editions: ${ref} must hold "${v.after}" in one place`);
		}
		text = text.slice(0, at) + v.before + text.slice(at + v.after.length);
	}
	return text;
}

// Each position of the plain text of an HTML string, in the HTML (tags skipped).
function plainMap(html: string): { plain: string; at: number[] } {
	let plain = "";
	const at: number[] = [];
	for (let i = 0; i < html.length; i++) {
		if (html[i] === "<") {
			const end = html.indexOf(">", i);
			if (end > 0) {
				i = end;
				continue;
			}
		}
		plain += html[i];
		at.push(i);
	}
	return { plain, at };
}

/** The htmlText of a paragraph in an edition. Only the changed part of each row is replaced, so the
 * markup stays; a format row (italics only) is not undone. */
export function htmlInEdition(ref: string, html: string, edition: Edition): string {
	const undo = undoneIn(ref, edition)
		.map((v, i) => ({ v, i }))
		.sort((a, b) => yearOf(b.v) - yearOf(a.v) || b.i - a.i);
	let out = html;
	for (const { v } of undo) {
		const { plain, at } = plainMap(out);
		const found = plain.indexOf(v.after);
		if (found < 0 || plain.indexOf(v.after, found + 1) >= 0) {
			throw new Error(`editions: the html of ${ref} must hold "${v.after}" in one place`);
		}
		// The changed core: the row without the start and the end that both sides share.
		let head = 0;
		while (head < v.after.length && head < v.before.length && v.after[head] === v.before[head])
			head++;
		let tail = 0;
		while (
			tail < v.after.length - head &&
			tail < v.before.length - head &&
			v.after[v.after.length - 1 - tail] === v.before[v.before.length - 1 - tail]
		)
			tail++;
		const from = found + head;
		const to = found + v.after.length - tail;
		const start = at[from] ?? out.length;
		const end = to > from ? (at[to - 1] ?? start - 1) + 1 : start;
		out = out.slice(0, start) + v.before.slice(head, v.before.length - tail) + out.slice(end);
	}
	return out;
}

/** An edition as an answer shows it. */
export function editionInfo(e: Edition) {
	return {
		id: e.id,
		label: e.label,
		year: e.year,
		foundationVersion: e.foundationVersion,
		versionStamp: e.versionStamp,
	};
}

/** A variant as an answer shows it. `applied`: the stored (default) text has the change. */
export function publicVariant(v: Variant) {
	return {
		year: v.year,
		kind: v.kind,
		before: v.before,
		after: v.after,
		applied: v.inStoredText,
		source: v.source,
		...(v.foundBy ? { foundBy: v.foundBy } : {}),
		page1955: v.page1955,
		reason: v.reason,
		...(v.note ? { note: v.note } : {}),
	};
}

export type PublicVariant = ReturnType<typeof publicVariant>;

type TextRow = { standardReferenceId: string; text: string; htmlText?: string | null };

/** Rows in an edition: `text` and `htmlText` of that edition, and `edition` with its id. */
export function inEdition<T extends TextRow>(
	rows: T[],
	edition: Edition,
): (T & { edition: string })[] {
	return rows.map((r) => {
		if (edition.id === DEFAULT_EDITION || undoneIn(r.standardReferenceId, edition).length === 0) {
			return { ...r, edition: edition.id };
		}
		return {
			...r,
			text: textInEdition(r.standardReferenceId, r.text, edition),
			...(r.htmlText != null
				? { htmlText: htmlInEdition(r.standardReferenceId, r.htmlText, edition) }
				: {}),
			edition: edition.id,
		};
	});
}

/** Rows with `variants`: the changes of each paragraph, [] for most. */
export function withVariants<T extends { standardReferenceId: string }>(rows: T[]) {
	return rows.map((r) => ({
		...r,
		variants: variantsOf(r.standardReferenceId).map(publicVariant),
	}));
}

export type EditionChoice = { edition: Edition } | { error: string; type: string };

/** The edition a request asks for. Another edition than the default needs the English text. */
export function chooseEdition(id: string | undefined, lang: string | undefined): EditionChoice {
	const edition = resolveEdition(id ?? DEFAULT_EDITION);
	if (!edition) {
		return {
			error: `Unknown edition "${id}". Use one of: ${EDITIONS.map((e) => e.id).join(", ")} (the list: GET /editions, or the MCP tool editions.list).`,
			type: "unknown-edition",
		};
	}
	if (edition.id !== DEFAULT_EDITION && lang && lang !== "eng") {
		return {
			error: `The edition "${edition.id}" is English only. Leave out lang, or use the default edition.`,
			type: "edition-needs-english",
		};
	}
	return { edition };
}

/** True when `include` names `variants`. */
export function wantsVariants(include: string | undefined): boolean {
	return !!include && include.split(",").some((s) => s.trim() === "variants");
}

/** Rows of a route in an edition, with `variants` when `include` asks for them. */
export function editionRows<T extends TextRow>(
	rows: T[],
	edition: Edition,
	include: string | undefined,
) {
	const out = inEdition(rows, edition);
	return wantsVariants(include) ? withVariants(out) : out;
}

/** The changes adopted in an edition: the rows of its year (srt-2009 also holds the undated ones). */
export function adoptedIn(edition: Edition): Variant[] {
	return edition.year === 1955 ? [] : VARIANTS.filter((v) => yearOf(v) === edition.year);
}

/** Each edition with `default` and its count of adopted changes. */
export function editionsList() {
	return {
		data: EDITIONS.map((e) => ({
			...editionInfo(e),
			default: e.id === DEFAULT_EDITION,
			changes: adoptedIn(e).length,
		})),
		meta: { default: DEFAULT_EDITION, variants: VARIANTS.length },
	};
}

export type VariantFilter = {
	paper?: string;
	ref?: string;
	kind?: VariantKind;
	edition?: string;
	from?: string;
	to?: string;
};

const PAPER_ID = /^(0|[1-9]\d{0,2})$/;

/** The changes that match a filter, or the error of a bad filter value. */
export function findVariants(
	f: VariantFilter,
):
	| { data: (PublicVariant & { ref: string })[]; meta: { total: number; applied: number } }
	| { error: string; type: string } {
	const paper = f.paper?.trim();
	if (paper !== undefined && !(PAPER_ID.test(paper) && Number(paper) <= 196)) {
		return {
			error: `Invalid paper "${f.paper}". Use a number from 0 to 196.`,
			type: "invalid-paper",
		};
	}
	const ref = f.ref?.trim();
	if (ref !== undefined && detectRefFormat(ref) !== "standardReferenceId") {
		return {
			error: `Invalid reference "${f.ref}". Use the paper:section.paragraph form, for example 98:3.8.`,
			type: "invalid-reference-format",
		};
	}
	const unknown = (id: string) => ({
		error: `Unknown edition "${id}". Use one of: ${EDITIONS.map((e) => e.id).join(", ")}.`,
		type: "unknown-edition",
	});
	const ranged = f.from !== undefined || f.to !== undefined;
	let rows = VARIANTS;
	if (f.edition !== undefined) {
		if (ranged) {
			return {
				error: "Give `edition` (one edition) or `from` and `to` (two editions), not both.",
				type: "invalid-edition-range",
			};
		}
		const edition = resolveEdition(f.edition);
		if (!edition) return unknown(f.edition);
		rows = adoptedIn(edition);
	} else if (ranged) {
		// The changes between two editions: adopted after `from`, up to and including `to`.
		const from = resolveEdition(f.from ?? "1955");
		if (!from) return unknown(f.from ?? "");
		const to = resolveEdition(f.to ?? DEFAULT_EDITION);
		if (!to) return unknown(f.to ?? "");
		if (from.year >= to.year) {
			return {
				error: `\`from\` (${from.id}) must be an older edition than \`to\` (${to.id}).`,
				type: "invalid-edition-range",
			};
		}
		rows = VARIANTS.filter((v) => yearOf(v) > from.year && yearOf(v) <= to.year);
	}
	const data = rows
		.filter(
			(v) =>
				(paper === undefined || v.ref.split(":")[0] === paper) &&
				(ref === undefined || v.ref === ref) &&
				(f.kind === undefined || v.kind === f.kind),
		)
		.map((v) => ({ ref: v.ref, ...publicVariant(v) }));
	return { data, meta: { total: data.length, applied: data.filter((v) => v.applied).length } };
}
