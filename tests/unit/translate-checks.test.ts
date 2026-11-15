import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { numbers, termPresent, textHash } from "../../scripts/translate/agent/checks.ts";
import { ENG_DIR, type Term, termsInText } from "../../scripts/translate/agent/lib.ts";

const term = (target: string, aliases: string[] = []) =>
	({ en: "x", target, aliases, enForms: ["x"], meaning: "", required: true }) as unknown as Term;

describe("termPresent", () => {
	test("a plural glossary form matches a singular in the text", () => {
		expect(termPresent(term("Hijos Materiales"), "el fracaso del Hijo Material")).toBe(true);
		expect(termPresent(term("Hijos de Dios"), "Hijo del Hombre e Hijo de Dios")).toBe(true);
	});

	test("a masculine form matches a feminine one", () => {
		expect(termPresent(term("chinos"), "las tribus chinas del norte")).toBe(true);
	});

	test("a word must start a word of the text, not sit inside one", () => {
		expect(termPresent(term("mente"), "Tengan presente que todo lo que hacen")).toBe(false);
		expect(termPresent(term("mente"), "la mente humana")).toBe(true);
	});

	test("a long stem matches inside a compound word", () => {
		expect(termPresent(term("revelación"), "por una técnica cósmica de autorrevelación")).toBe(
			true,
		);
		expect(termPresent(term("Cristo"), "del Señor Jesucristo")).toBe(true);
	});

	test("a missing term is still missing", () => {
		expect(
			termPresent(term("Ajustador del Pensamiento"), "el espíritu que mora en el hombre"),
		).toBe(false);
	});
});

describe("numbers", () => {
	test("English thousands separators do not join two numbers", () => {
		expect(numbers("from the year a.d. 1934, 37,848 years ago", "en")).toEqual(["1934", "37848"]);
		expect(numbers("of the original 50,000, 40,119 had joined", "en")).toEqual(["50000", "40119"]);
	});

	test("scale words give the same value in both languages", () => {
		expect(numbers("almost 138 billion servitals", "en")).toEqual(["138000000000"]);
		expect(numbers("casi 138 000 millones de servitales", "es")).toEqual(["138000000000"]);
		expect(numbers("1.5 million", "en")).toEqual(numbers("1,5 millones", "es"));
	});

	test("Spanish thousands separators are read", () => {
		expect(numbers("hace 37 848 años", "es")).toEqual(["37848"]);
		expect(numbers("de los 50.000 originales", "es")).toEqual(["50000"]);
	});
});

// termsInText reads the English papers beside the repo; CI has no copy of them.
describe.skipIf(!existsSync(ENG_DIR))("termsInText", () => {
	const names = (text: string) => termsInText("es", text).map((t) => t.en);

	test("a bare name shared by two terms matches neither", () => {
		expect(names("believed Philip’s preaching")).not.toContain("Philip (Tetrarch)");
		expect(names("believed Philip’s preaching")).not.toContain("Philip (Apostle)");
	});

	test("an alias that names another term belongs to that term", () => {
		const found = names("the Paradise Corps of the Finality");
		expect(found).toContain("Paradise Corps of the Finality");
		expect(found).not.toContain("Corps of Paradise Finaliters");
	});

	test("one word of a longer name is not the name", () => {
		expect(names("the elevating mountainous regions of the Indian peninsula")).not.toContain(
			"Indian Ocean",
		);
		expect(names("the shores of the Indian Ocean")).toContain("Indian Ocean");
	});
});

test("textHash changes with the text", () => {
	expect(textHash("a")).not.toBe(textHash("b"));
	expect(textHash("a")).toHaveLength(16);
});
