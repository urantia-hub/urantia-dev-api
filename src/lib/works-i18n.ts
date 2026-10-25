// The catalog words of the works in another language (data/translations/es/works.json): titles,
// traditions, summaries, labels, chapter titles, and Bible book names. The text of each work stays English.
import es from "../../data/translations/es/works.json";

export type CatalogLang = "eng" | "es" | "fr" | "pt" | "de" | "ko";
export type CatalogTranslation = { method: "machine"; license: "CC0-1.0"; review: string | null };
export type CatalogMarks = { textLanguage: "eng"; catalogTranslation?: CatalogTranslation };

type WorkWords = {
	title?: string;
	tradition?: string;
	summary?: string;
	unitLabel?: string;
	divisionLabel?: string;
};
type Catalog = {
	review: string | null;
	works: Record<string, WorkWords>;
	titles: Record<string, Record<string, string>>;
	books: Record<string, { bookName: string; fullName: string }>;
};

// A language with no catalog here gives the English words.
const CATALOGS: Partial<Record<CatalogLang, Catalog>> = { es };

const label = (c: Catalog): CatalogTranslation => ({
	method: "machine",
	license: "CC0-1.0",
	review: c.review,
});

/** The catalog of a language, or undefined for English and a language with none. */
export function catalogFor(lang: CatalogLang): Catalog | undefined {
	return lang === "eng" ? undefined : CATALOGS[lang];
}

/**
 * A work with the words of `lang` over its English ones. Only the fields that the work has are
 * replaced; a field with no translation keeps English. `religion` takes the tradition. `key` is the
 * work id of the catalog ("bible" or the slug) when `work.id` is another id (a corpus id).
 */
export function localizeWork<
	T extends {
		id: string;
		title?: string;
		tradition?: string;
		religion?: string;
		summary?: string;
		unitLabel?: string;
		divisionLabel?: string;
	},
>(work: T, lang: CatalogLang, key: string = work.id): T & CatalogMarks {
	const catalog = catalogFor(lang);
	const words = catalog?.works[key];
	if (!catalog || !words) return { ...work, textLanguage: "eng" };
	const out: Record<string, unknown> = { ...work };
	for (const field of ["title", "tradition", "summary", "unitLabel", "divisionLabel"] as const)
		if (field in work && words[field]) out[field] = words[field];
	if ("religion" in work && words.tradition) out.religion = words.tradition;
	return { ...(out as T), textLanguage: "eng", catalogTranslation: label(catalog) };
}

/** The title of a chapter, a book, or a page of a work in `lang`, or the English title when none. */
export function localizeTitle(workId: string, title: string | null, lang: CatalogLang) {
	if (title === null) return null;
	return catalogFor(lang)?.titles[workId]?.[title] ?? title;
}

/** Divisions or pages of a work with their titles in `lang`. */
export function localizeTitled<T extends { title: string | null }>(
	workId: string,
	items: T[],
	lang: CatalogLang,
): T[] {
	if (!catalogFor(lang)) return items;
	return items.map((i) => ({ ...i, title: localizeTitle(workId, i.title, lang) }));
}

/** A Bible book with its names in `lang`. */
export function localizeBook<T extends { bookCode: string; bookName: string; fullName: string }>(
	book: T,
	lang: CatalogLang,
): T & { catalogTranslation?: CatalogTranslation } {
	const catalog = catalogFor(lang);
	const names = catalog?.books[book.bookCode];
	if (!catalog || !names) return book;
	return { ...book, ...names, catalogTranslation: label(catalog) };
}
