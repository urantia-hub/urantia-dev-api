import { describe, expect, it } from "bun:test";
import {
	BIBLE_BOOKS,
	bibleVerseId,
	formatBibleReference,
	osisFromUsfm,
	resolveBibleBook,
} from "../../src/lib/bible-canonicalizer.ts";

describe("BIBLE_BOOKS table", () => {
	it("contains 81 books", () => {
		expect(BIBLE_BOOKS).toHaveLength(81);
	});

	it("has 39 OT, 15 deuterocanon, 27 NT", () => {
		const counts = { ot: 0, deuterocanon: 0, nt: 0 };
		for (const b of BIBLE_BOOKS) counts[b.canon]++;
		expect(counts).toEqual({ ot: 39, deuterocanon: 15, nt: 27 });
	});

	it("has unique OSIS codes, USFM codes, and orders", () => {
		const osis = new Set(BIBLE_BOOKS.map((b) => b.osis));
		const usfm = new Set(BIBLE_BOOKS.map((b) => b.usfm));
		const orders = new Set(BIBLE_BOOKS.map((b) => b.order));
		expect(osis.size).toBe(81);
		expect(usfm.size).toBe(81);
		expect(orders.size).toBe(81);
	});

	it("has contiguous order 1..81", () => {
		const sorted = [...BIBLE_BOOKS].map((b) => b.order).sort((a, b) => a - b);
		expect(sorted[0]).toBe(1);
		expect(sorted[80]).toBe(81);
	});
});

describe("resolveBibleBook", () => {
	it("resolves canonical OSIS codes", () => {
		expect(resolveBibleBook("Gen")?.osis).toBe("Gen");
		expect(resolveBibleBook("Matt")?.osis).toBe("Matt");
		expect(resolveBibleBook("Rev")?.osis).toBe("Rev");
		expect(resolveBibleBook("1Macc")?.osis).toBe("1Macc");
	});

	it("is case-insensitive", () => {
		expect(resolveBibleBook("gen")?.osis).toBe("Gen");
		expect(resolveBibleBook("GENESIS")?.osis).toBe("Gen");
		expect(resolveBibleBook("matT")?.osis).toBe("Matt");
	});

	it("handles separators and whitespace", () => {
		expect(resolveBibleBook("1 Maccabees")?.osis).toBe("1Macc");
		expect(resolveBibleBook("1-maccabees")?.osis).toBe("1Macc");
		expect(resolveBibleBook("1_macc")?.osis).toBe("1Macc");
	});

	it("resolves USFM codes", () => {
		expect(resolveBibleBook("GEN")?.osis).toBe("Gen");
		expect(resolveBibleBook("MAT")?.osis).toBe("Matt");
		expect(resolveBibleBook("DAG")?.osis).toBe("DanGr");
		expect(resolveBibleBook("PHP")?.osis).toBe("Phil");
		expect(resolveBibleBook("PS2")?.osis).toBe("AddPs");
	});

	it("resolves full book names", () => {
		expect(resolveBibleBook("Genesis")?.osis).toBe("Gen");
		expect(resolveBibleBook("Revelation")?.osis).toBe("Rev");
		expect(resolveBibleBook("Song of Solomon")?.osis).toBe("Song");
		expect(resolveBibleBook("Wisdom of Solomon")?.osis).toBe("Wis");
	});

	it("resolves common aliases", () => {
		expect(resolveBibleBook("Psalm")?.osis).toBe("Ps");
		expect(resolveBibleBook("Apocalypse")?.osis).toBe("Rev");
		expect(resolveBibleBook("Sirach")?.osis).toBe("Sir");
		expect(resolveBibleBook("Ecclesiasticus")?.osis).toBe("Sir");
		expect(resolveBibleBook("Canticles")?.osis).toBe("Song");
	});

	it("resolves embedded books to their containing canonical book", () => {
		// Letter of Jeremiah is Baruch ch 6
		expect(resolveBibleBook("Letter of Jeremiah")?.osis).toBe("Bar");
		expect(resolveBibleBook("EpJer")?.osis).toBe("Bar");
		// Prayer of Azariah, Susanna, Bel and the Dragon are inside DanGr
		expect(resolveBibleBook("Susanna")?.osis).toBe("DanGr");
		expect(resolveBibleBook("Bel and the Dragon")?.osis).toBe("DanGr");
	});

	it("returns null for unknown input", () => {
		expect(resolveBibleBook("NotABook")).toBeNull();
		expect(resolveBibleBook("")).toBeNull();
	});

	it("resolves alternate Septuagint numbering for Esdras", () => {
		// Some traditions number 1Esd/2Esd as 3Ezra/4Ezra
		expect(resolveBibleBook("3Esdras")?.osis).toBe("1Esd");
		expect(resolveBibleBook("4Esdras")?.osis).toBe("2Esd");
	});
});

describe("osisFromUsfm", () => {
	it("converts standard USFM codes to OSIS", () => {
		expect(osisFromUsfm("GEN")).toBe("Gen");
		expect(osisFromUsfm("PSA")).toBe("Ps");
		expect(osisFromUsfm("MAT")).toBe("Matt");
		expect(osisFromUsfm("REV")).toBe("Rev");
	});

	it("handles deuterocanon codes", () => {
		expect(osisFromUsfm("TOB")).toBe("Tob");
		expect(osisFromUsfm("DAG")).toBe("DanGr");
		expect(osisFromUsfm("ESG")).toBe("EsthGr");
		expect(osisFromUsfm("BAR")).toBe("Bar");
		expect(osisFromUsfm("MAN")).toBe("PrMan");
	});

	it("returns null for unknown codes", () => {
		expect(osisFromUsfm("XYZ")).toBeNull();
		expect(osisFromUsfm("")).toBeNull();
	});
});

describe("formatBibleReference", () => {
	it("formats book + chapter + verse", () => {
		expect(formatBibleReference("Gen", 1, 1)).toBe("Genesis 1:1");
		expect(formatBibleReference("1Macc", 2, 19)).toBe("1 Maccabees 2:19");
		expect(formatBibleReference("DanGr", 3, 24)).toBe("Daniel (Greek) 3:24");
	});

	it("formats book + chapter only", () => {
		expect(formatBibleReference("Gen", 1)).toBe("Genesis 1");
	});

	it("returns null for unknown OSIS", () => {
		expect(formatBibleReference("NotABook", 1, 1)).toBeNull();
	});
});

describe("bibleVerseId", () => {
	it("builds OSIS-style ids", () => {
		expect(bibleVerseId("Gen", 1, 1)).toBe("Gen.1.1");
		expect(bibleVerseId("Matt", 5, 3)).toBe("Matt.5.3");
		expect(bibleVerseId("1Macc", 2, 19)).toBe("1Macc.2.19");
	});
});
