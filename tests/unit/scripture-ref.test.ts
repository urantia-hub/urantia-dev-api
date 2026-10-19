import { describe, expect, test } from "bun:test";
import { CORPORA } from "../../scripts/scriptures/corpora.ts";
import { MAX_RANGE, namesDivision, parseScriptureRef } from "../../src/lib/scripture-ref.ts";

describe("parseScriptureRef", () => {
	test("reads a two-level ref, with either separator and with or without the prefix", () => {
		expect(parseScriptureRef("2.47", "BG", 2)).toEqual({ path: [2, 47], end: 47, full: true });
		expect(parseScriptureRef("BG 2:47", "BG", 2)).toEqual({ path: [2, 47], end: 47, full: true });
		expect(parseScriptureRef("bg  2.47-49", "BG", 2)).toEqual({
			path: [2, 47],
			end: 49,
			full: true,
		});
	});

	test("reads a shorter ref as a whole part", () => {
		expect(parseScriptureRef("25", "TTC", 2)).toEqual({ path: [25], end: 25, full: false });
		expect(parseScriptureRef("Epictetus 3.22", "Epictetus", 3)).toEqual({
			path: [3, 22],
			end: 22,
			full: false,
		});
	});

	test("reads one-level and three-level refs", () => {
		expect(parseScriptureRef("Dhp 183", "Dhp", 1)).toEqual({ path: [183], end: 183, full: true });
		expect(parseScriptureRef("58-59", "Dhp", 1)).toEqual({ path: [58], end: 59, full: true });
		expect(parseScriptureRef("Japji 0", "Japji", 1)).toEqual({ path: [0], end: 0, full: true });
		expect(parseScriptureRef("3.22.45", "Epictetus", 3)).toEqual({
			path: [3, 22, 45],
			end: 45,
			full: true,
		});
	});

	test("rejects text that is not a reference, too many levels, or a range above the final level", () => {
		for (const bad of ["", "abc", "2.", "2.47-40", "1.1.1", "Analects 1,1", "12345", "2-3"]) {
			expect(parseScriptureRef(bad, "Analects", 2)).toBeNull();
		}
		expect(parseScriptureRef("3.22.5.1", "Epictetus", 3)).toBeNull();
		expect(parseScriptureRef("3.22-23", "Epictetus", 3)).toBeNull();
	});

	test("rejects a range over the maximum", () => {
		expect(parseScriptureRef(`1-${MAX_RANGE}`, "Dhp", 1)).not.toBeNull();
		expect(parseScriptureRef(`1-${MAX_RANGE + 1}`, "Dhp", 1)).toBeNull();
	});
});

const BOM = [
	"1 Nephi",
	"2 Nephi",
	"Jacob",
	"Enos",
	"Jarom",
	"Omni",
	"Words of Mormon",
	"Mosiah",
	"Alma",
	"Helaman",
	"3 Nephi",
	"4 Nephi",
	"Mormon",
	"Ether",
	"Moroni",
];

describe("a division name in place of the first number", () => {
	test("reads a book name, any case, either separator, and the numeric form", () => {
		expect(parseScriptureRef("1 Nephi 3:7", "BoM", 3, BOM)?.path).toEqual([1, 3, 7]);
		expect(parseScriptureRef("alma 32.21", "BoM", 3, BOM)?.path).toEqual([9, 32, 21]);
		expect(parseScriptureRef("Words of Mormon 1:7", "BoM", 3, BOM)?.path).toEqual([7, 1, 7]);
		expect(parseScriptureRef("BoM 9.32.21", "BoM", 3, BOM)?.path).toEqual([9, 32, 21]);
		expect(parseScriptureRef("Alma 32", "BoM", 3, BOM)).toEqual({
			path: [9, 32],
			end: 32,
			full: false,
		});
	});
	test("reads a short form that names one book only", () => {
		expect(parseScriptureRef("1 ne 3:7", "BoM", 3, BOM)?.path).toEqual([1, 3, 7]);
		expect(parseScriptureRef("hel 5:12", "BoM", 3, BOM)?.path).toEqual([10, 5, 12]);
		expect(parseScriptureRef("mo 1:1", "BoM", 3, BOM)).toBeNull(); // Mosiah, Mormon, Moroni
	});
	test("refuses an unknown name and a range across books", () => {
		expect(parseScriptureRef("Nephi 3:7", "BoM", 3, BOM)).toBeNull();
		expect(parseScriptureRef("1 Nephi 22:30-2 Nephi 1:2", "BoM", 3, BOM)).toBeNull();
		expect(parseScriptureRef("Almagest 3:1", "BoM", 3, BOM)).toBeNull();
	});
	test("matches a name with no accents and any case, and a listed alias", () => {
		expect(parseScriptureRef("VOLUSPO 3", "Edda", 2, ["Voluspo"])?.path).toEqual([1, 3]);
		expect(parseScriptureRef("völuspá 3", "Edda", 2, ["Voluspo"], { voluspa: 1 })?.path).toEqual([
			1, 3,
		]);
		expect(parseScriptureRef("volva 3", "Edda", 2, ["Voluspo"], { voluspa: 1 })).toBeNull();
	});
	test("takes other spellings of a name after a bar", () => {
		expect(parseScriptureRef("voluspa 3", "Edda", 2, ["Voluspo|Voluspa"])?.path).toEqual([1, 3]);
		expect(parseScriptureRef("Voluspo 3", "Edda", 2, ["Voluspo|Voluspa"])?.path).toEqual([1, 3]);
	});
	test("keeps a work with no names as before", () => {
		expect(parseScriptureRef("Alma 32:21", "BG", 2)).toBeNull();
	});
});

describe("a ref that names its work by a division name", () => {
	test("is a full name or a listed spelling, never a short form", () => {
		expect(namesDivision("Alma 32:21", BOM)).toBe(true);
		expect(namesDivision("words of mormon 1:7", BOM)).toBe(true);
		expect(namesDivision("voluspa 3", ["Voluspo|Voluspa"])).toBe(true);
		expect(namesDivision("hel 5:12", BOM)).toBe(false);
		expect(namesDivision("John 3:16", BOM)).toBe(false);
		expect(namesDivision("Alma 32:21", null)).toBe(false);
	});
});

describe("the named poems of batch 2", () => {
	const poems = CORPORA.find((c) => c.id === "poetic-edda-bellows-1923")?.divisionNames ?? [];
	const hesiod = CORPORA.find((c) => c.id === "hesiod-evelyn-white-1914")?.divisionNames ?? [];

	test("reads a poem of the Edda by Bellows's name or the usual spelling", () => {
		expect(parseScriptureRef("Voluspo 3", "Edda", 2, poems)?.path).toEqual([1, 3]);
		expect(parseScriptureRef("Völuspá 3", "Edda", 2, poems)?.path).toEqual([1, 3]);
		expect(parseScriptureRef("Havamal 77", "Edda", 2, poems)?.path).toEqual([2, 77]);
	});

	test("tells the first and the second lay of a name apart", () => {
		expect(parseScriptureRef("Helgakvitha Hundingsbana I 3", "Edda", 2, poems)?.path).toEqual([
			17, 3,
		]);
		expect(parseScriptureRef("Helgakvitha Hundingsbana II 3", "Edda", 2, poems)?.path).toEqual([
			18, 3,
		]);
		expect(parseScriptureRef("Guthrunarkvitha III 3", "Edda", 2, poems)?.path).toEqual([30, 3]);
	});

	test("reads a line of Hesiod by the name of its poem", () => {
		expect(parseScriptureRef("Theogony 116-138", "Hesiod", 2, hesiod)).toEqual({
			path: [1, 116],
			end: 138,
			full: true,
		});
		expect(parseScriptureRef("Works and Days 120", "Hesiod", 2, hesiod)?.path).toEqual([2, 120]);
	});

	test("reads a whole poem or book by its name alone, but never by a short form of it", () => {
		expect(parseScriptureRef("Theogony", "Hesiod", 2, hesiod)).toEqual({
			path: [1],
			end: 1,
			full: false,
		});
		expect(parseScriptureRef("Hesiod Works and Days", "Hesiod", 2, hesiod)?.path).toEqual([2]);
		expect(parseScriptureRef("Hovamol", "Edda", 2, poems)?.path).toEqual([2]);
		expect(parseScriptureRef("Helgakvitha Hundingsbana II", "Edda", 2, poems)?.path).toEqual([18]);
		expect(parseScriptureRef("1 Nephi", "BoM", 3, BOM)?.path).toEqual([1]);
		expect(parseScriptureRef("the", "Hesiod", 2, hesiod)).toBeNull();
		expect(parseScriptureRef("Theo", "Hesiod", 2, hesiod)).toBeNull();
	});
});

describe("the named parts of the Wikisource works of batch 2", () => {
	const names = (id: string) => CORPORA.find((c) => c.id === id)?.divisionNames ?? [];

	test("reads a chapter and a paragraph of the Prose Edda, with or without its accents", () => {
		const parts = names("prose-edda-brodeur-1916");
		expect(parseScriptureRef("Gylfaginning 34.2", "Prose Edda", 3, parts)?.path).toEqual([
			2, 34, 2,
		]);
		expect(parseScriptureRef("Gylfaginning 34", "Prose Edda", 3, parts)).toEqual({
			path: [2, 34],
			end: 34,
			full: false,
		});
		expect(parseScriptureRef("Skaldskaparmal 3.1", "Prose Edda", 3, parts)?.path).toEqual([
			3, 3, 1,
		]);
	});

	test("reads each Upanishad by its own numbers and its other names", () => {
		const ups = names("upanishads-muller-1879");
		expect(parseScriptureRef("Khandogya 6.8", "Upanishad", 3, ups)?.path).toEqual([1, 6, 8]);
		expect(parseScriptureRef("Chandogya 6.8", "Upanishad", 3, ups)?.path).toEqual([1, 6, 8]);
		expect(parseScriptureRef("Kena 1.3", "Upanishad", 3, ups)?.path).toEqual([2, 1, 3]);
		// "Isa 6" names the subdivision that holds verse 6 alone.
		expect(parseScriptureRef("Isa 6", "Upanishad", 3, ups)).toEqual({
			path: [3, 6],
			end: 6,
			full: false,
		});
	});
});
