// The editions of the English text, and the text of a paragraph in each. The stored text is the
// newest edition; an older one undoes the variants after its year (data/editions/variants.json).
import rows from "../../data/editions/variants.json";

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
	source: { list: string; report: string | null };
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
