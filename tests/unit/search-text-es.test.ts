import { describe, expect, it } from "bun:test";
import { highlightEs, normalizeQueryEs, parsePaperRefEs } from "../../src/lib/search-text-es.ts";

describe("normalizeQueryEs", () => {
	it("keeps the words in lower case", () => {
		expect(normalizeQueryEs("Ajustador del Pensamiento").words).toEqual(["ajustador", "del", "pensamiento"]);
	});
	it("folds accents, the diaeresis, and ñ", () => {
		expect(normalizeQueryEs("religión").text).toBe(normalizeQueryEs("religion").text);
		expect(normalizeQueryEs("año").text).toBe("ano");
		expect(normalizeQueryEs("Pingüino ÁRBOL").text).toBe("pinguino arbol");
	});
	it("drops the Spanish question and exclamation marks", () => {
		expect(normalizeQueryEs("¿Qué es la morontia?").words).toEqual(["que", "es", "la", "morontia"]);
		expect(normalizeQueryEs("¡Fe!").words).toEqual(["fe"]);
	});
	it("marks a quoted query", () => {
		expect(normalizeQueryEs("“la fe viva”").quoted).toBe(true);
	});
});

describe("parsePaperRefEs", () => {
	it("reads documento and doc. before a reference", () => {
		expect(parsePaperRefEs("documento 1")).toEqual({ paperId: "1" });
		expect(parsePaperRefEs("Documento 1:0.1")).toEqual({ paperId: "1", sectionId: "0", paragraphId: "1" });
		expect(parsePaperRefEs("doc. 99:1")).toEqual({ paperId: "99", sectionId: "1" });
		expect(parsePaperRefEs("1:0.1")).toEqual({ paperId: "1", sectionId: "0", paragraphId: "1" });
	});
	it("is null for words", () => {
		expect(parsePaperRefEs("documento del padre")).toBeNull();
	});
});

describe("highlightEs", () => {
	const mark = (s: string) => `<span class=urantia-dev-highlighted>${s}</span>`;
	it("marks each word, with or without its accents, outside the tags", () => {
		const html = '<span class="a">La religión del Ajustador</span>';
		expect(highlightEs(html, ["religion", "ajustador"], false)).toBe(
			`<span class="a">La ${mark("religión")} del ${mark("Ajustador")}</span>`,
		);
	});
	it("marks the last word as a prefix when asked", () => {
		expect(highlightEs("los Ajustadores", ["ajustador"], true)).toBe(`los ${mark("Ajustadores")}`);
		expect(highlightEs("los Ajustadores", ["ajustador"], false)).toBe("los Ajustadores");
	});
	it("does not touch a word inside a tag", () => {
		expect(highlightEs('<span class="la">x</span>', ["la"], false)).toBe('<span class="la">x</span>');
	});
});
