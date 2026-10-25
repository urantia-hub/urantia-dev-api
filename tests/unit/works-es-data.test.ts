import { describe, expect, it } from "bun:test";
import catalog from "../../data/translations/es/works.json";
import { BIBLE_BOOKS } from "../../src/lib/bible-canonicalizer.ts";

// The Bible and the 21 texts of scripture_corpora, as /works lists them.
const WORK_IDS = [
	"bible",
	"diogenes-laertius-6",
	"epictetus-cynic",
	"dhammapada",
	"bhagavad-gita",
	"shinto-oracles",
	"tao-te-ching",
	"analects",
	"quran",
	"japji",
	"book-of-mormon",
	"rig-veda",
	"book-of-the-dead",
	"hesiod",
	"homeric-hymns",
	"poetic-edda",
	"aztec-hymns",
	"chuang-tzu",
	"prose-edda",
	"kojiki",
	"upanishads",
	"shu-king",
];

const values = (o: unknown): string[] =>
	typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(values) : [];

describe("the Spanish catalog file", () => {
	it("is Spanish and machine-made", () => {
		expect(catalog.language).toBe("es");
		expect(catalog.method).toBe("machine");
		expect(catalog.license).toBe("CC0-1.0");
	});

	it("names every work with a title, tradition, summary, and unit label", () => {
		expect(Object.keys(catalog.works).sort()).toEqual([...WORK_IDS].sort());
		for (const w of Object.values(catalog.works)) {
			for (const field of ["title", "tradition", "summary", "unitLabel"] as const)
				expect(w[field]?.trim()).toBeTruthy();
		}
	});

	it("names every Bible book", () => {
		expect(Object.keys(catalog.books).sort()).toEqual(BIBLE_BOOKS.map((b) => b.osis).sort());
		for (const b of Object.values(catalog.books)) {
			expect(b.bookName.trim()).toBeTruthy();
			expect(b.fullName.trim()).toBeTruthy();
		}
	});

	it("has titles only for known works, with no empty key or value", () => {
		for (const [work, titles] of Object.entries(catalog.titles)) {
			expect(WORK_IDS).toContain(work);
			for (const [en, es] of Object.entries(titles)) {
				expect(en.trim()).toBeTruthy();
				expect(es.trim()).toBeTruthy();
			}
		}
	});

	it("never labels a work with mito or myth", () => {
		for (const v of values(catalog)) expect(v).not.toMatch(/\bm[iíy]t(o|h|olog)/i);
	});
});
