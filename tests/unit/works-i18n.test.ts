import { describe, expect, it } from "bun:test";
// Adds .openapi() to zod, which the schemas file uses.
import "@hono/zod-openapi";
import {
	localizeBook,
	localizeTitle,
	localizeTitled,
	localizeWork,
} from "../../src/lib/works-i18n.ts";
import { CatalogLangQuery } from "../../src/validators/schemas.ts";

const dhammapada = {
	id: "dhammapada",
	title: "The Dhammapada",
	religion: "Buddhist",
	tradition: "Buddhist",
	summary: "A collection of the Buddha's sayings in verse.",
	unitLabel: "verse",
	units: 423,
};
const bible = {
	id: "bible",
	title: "The Bible (World English Bible)",
	religion: "Jewish and Christian",
	tradition: "Jewish and Christian",
	summary: "The Hebrew Bible, the deuterocanon, and the New Testament.",
	unitLabel: "verse",
};

describe("localizeWork", () => {
	it("gives the Spanish words and the label for es", () => {
		const w = localizeWork(dhammapada, "es");
		expect(w.title).toBe("El Dhammapada");
		expect(w.tradition).toBe("Budista");
		expect(w.religion).toBe("Budista");
		expect(w.summary).toBe("Una colección de dichos del Buda en verso.");
		expect(w.unitLabel).toBe("versículo");
		expect(w.units).toBe(423);
		expect(w.textLanguage).toBe("eng");
		expect(w.catalogTranslation).toEqual({
			method: "machine",
			license: "CC0-1.0",
			review: "auto_checked",
		});
	});

	it("keeps English for eng and adds only textLanguage", () => {
		expect(localizeWork(dhammapada, "eng")).toEqual({ ...dhammapada, textLanguage: "eng" });
	});

	it("keeps English for a work the file does not name", () => {
		const w = { id: "new-work", title: "A New Work", tradition: "Other", unitLabel: "verse" };
		expect(localizeWork(w, "es")).toEqual({ ...w, textLanguage: "eng" });
	});

	it("adds no field that the input does not have", () => {
		const w = localizeWork({ id: "dhammapada", title: "The Dhammapada" }, "es");
		expect(Object.keys(w).sort()).toEqual(["catalogTranslation", "id", "textLanguage", "title"]);
	});

	it("gives the Bible its Spanish title and unit label", () => {
		const w = localizeWork(bible, "es");
		expect(w.title).toBe("La Biblia (World English Bible)");
		expect(w.unitLabel).toBe("versículo");
		expect(w.tradition).toBe("Judío y cristiano");
	});
});

describe("localizeTitle", () => {
	it("gives the Spanish title of a chapter", () => {
		expect(localizeTitle("dhammapada", "The Twin-Verses", "es")).toBe("Los versos gemelos");
	});

	it("keeps English for eng, for an unknown title, and for an unknown work", () => {
		expect(localizeTitle("dhammapada", "The Twin-Verses", "eng")).toBe("The Twin-Verses");
		expect(localizeTitle("dhammapada", "A Changed Title", "es")).toBe("A Changed Title");
		expect(localizeTitle("new-work", "The Twin-Verses", "es")).toBe("The Twin-Verses");
	});

	it("keeps null", () => {
		expect(localizeTitle("dhammapada", null, "es")).toBeNull();
	});

	it("gives a division and a page with the same English the same Spanish", () => {
		const division = { division: 1, title: "The Twin-Verses", firstRef: "Dhp 1" };
		const page = { division: 1, subdivision: null, title: "The Twin-Verses", firstRef: "Dhp 1" };
		const [d] = localizeTitled("dhammapada", [division], "es");
		const [p] = localizeTitled("dhammapada", [page], "es");
		expect(d?.title).toBe("Los versos gemelos");
		expect(p?.title).toBe(d?.title as string);
		expect(p?.firstRef).toBe("Dhp 1");
	});
});

describe("localizeBook", () => {
	const gen = {
		bookCode: "Gen",
		bookName: "Genesis",
		fullName: "The First Book of Moses",
		abbr: "Gen",
	};

	it("gives the Spanish book names for es", () => {
		const b = localizeBook(gen, "es");
		expect(b.bookName).toBe("Génesis");
		expect(b.fullName).toBe("El primer libro de Moisés, comúnmente llamado Génesis");
		expect(b.abbr).toBe("Gen");
		expect(b.catalogTranslation?.method).toBe("machine");
	});

	it("keeps English for eng and for an unknown code", () => {
		expect(localizeBook(gen, "eng")).toEqual(gen);
		const x = { ...gen, bookCode: "Xyz" };
		expect(localizeBook(x, "es")).toEqual(x);
	});
});

describe("localizeWork with a corpus id", () => {
	it("finds the words by the slug given as the key", () => {
		const corpus = { id: "dhammapada-muller-1881", title: "The Dhammapada", religion: "Buddhist" };
		const w = localizeWork(corpus, "es", "dhammapada");
		expect(w.id).toBe("dhammapada-muller-1881");
		expect(w.title).toBe("El Dhammapada");
		expect(w.religion).toBe("Budista");
	});
});

describe("a reader language with no catalog", () => {
	it("is accepted by the query and gives English", () => {
		expect(CatalogLangQuery.parse({ lang: "fr" }).lang).toBe("fr");
		expect(CatalogLangQuery.safeParse({ lang: "xx" }).success).toBe(false);
		expect(localizeWork(dhammapada, "fr")).toEqual({ ...dhammapada, textLanguage: "eng" });
		expect(localizeTitle("dhammapada", "The Twin-Verses", "ko")).toBe("The Twin-Verses");
	});
});
