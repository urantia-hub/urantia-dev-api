import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { parseUsfm } from "../../src/lib/usfm-parser.ts";

const USFM_DIR =
	"/Users/kelsonic/Desktop/business/urantia/urantia-data-sources/data/bible/eng-web_usfm";

const usfm = (file: string) => readFileSync(`${USFM_DIR}/${file}`, "utf-8");

describe("parseUsfm — basic shape", () => {
	it("parses Genesis with the right book and verse count", () => {
		const r = parseUsfm(usfm("02-GENeng-web.usfm"));
		expect(r).not.toBeNull();
		expect(r?.bookCode).toBe("Gen");
		expect(r?.usfmCode).toBe("GEN");
		// Genesis has 1,533 verses across 50 chapters
		expect(r?.verses.length).toBe(1533);
		const chapters = new Set(r?.verses.map((v) => v.chapter));
		expect(chapters.size).toBe(50);
	});

	it("parses every verse with non-empty text and a chapter+verse number", () => {
		const r = parseUsfm(usfm("02-GENeng-web.usfm"));
		expect(r).not.toBeNull();
		for (const v of r!.verses) {
			expect(v.bookCode).toBe("Gen");
			expect(v.chapter).toBeGreaterThan(0);
			expect(v.verse).toBeGreaterThan(0);
			expect(v.text.length).toBeGreaterThan(0);
		}
	});

	it("returns null for content with no \\id line", () => {
		expect(parseUsfm("\\h Genesis\n\\v 1 hello")).toBeNull();
	});

	it("returns null for unknown USFM book code", () => {
		expect(parseUsfm("\\id XYZ World English Bible\n\\c 1\n\\v 1 hello")).toBeNull();
	});
});

describe("parseUsfm — content cleanup", () => {
	it("strips Strong's number wrappers from Genesis 1:1", () => {
		const r = parseUsfm(usfm("02-GENeng-web.usfm"));
		const verse = r?.verses.find((v) => v.chapter === 1 && v.verse === 1);
		expect(verse?.text).toBe("In the beginning, God created the heavens and the earth.");
	});

	it("strips footnotes from Genesis 2:4 but preserves Yahweh in WEB Classic", () => {
		const r = parseUsfm(usfm("02-GENeng-web.usfm"));
		const verse = r?.verses.find((v) => v.chapter === 2 && v.verse === 4);
		expect(verse?.text).toContain("Yahweh");
		// Footnote about LORD rendering should not leak into the verse text
		expect(verse?.text).not.toContain("LORD");
		expect(verse?.text).not.toContain("\\f");
	});

	it("strips nested \\+w markers inside words-of-Jesus blocks (Matt 5:3)", () => {
		const r = parseUsfm(usfm("70-MATeng-web.usfm"));
		const verse = r?.verses.find((v) => v.chapter === 5 && v.verse === 3);
		expect(verse?.text).toContain("Blessed are the poor in spirit");
		expect(verse?.text).not.toContain("strong=");
		expect(verse?.text).not.toContain("\\w");
		expect(verse?.text).not.toContain("\\+");
	});

	it("strips cross-references but keeps the verse text (Matt 5:3 has \\x...\\x* tail)", () => {
		const r = parseUsfm(usfm("70-MATeng-web.usfm"));
		const verse = r?.verses.find((v) => v.chapter === 5 && v.verse === 3);
		expect(verse?.text).not.toContain("Isaiah 57:15");
		expect(verse?.text).not.toContain("\\x");
	});

	it("preserves John 11:35 short verse", () => {
		const r = parseUsfm(usfm("73-JHNeng-web.usfm"));
		const verse = r?.verses.find((v) => v.chapter === 11 && v.verse === 35);
		expect(verse?.text).toBe("Jesus wept.");
	});
});

describe("parseUsfm — paragraph markers", () => {
	it("tracks the most-recent paragraph marker (\\p, \\q1, etc.) per verse", () => {
		const r = parseUsfm(usfm("02-GENeng-web.usfm"));
		const verse = r?.verses.find((v) => v.chapter === 1 && v.verse === 1);
		expect(verse?.paragraphMarker).toBe("p");
	});

	it("captures poetry markers (\\q1) for Psalms-style content", () => {
		const r = parseUsfm(usfm("70-MATeng-web.usfm"));
		const beatitude = r?.verses.find((v) => v.chapter === 5 && v.verse === 3);
		expect(beatitude?.paragraphMarker).toBe("q1");
	});
});

describe("parseUsfm — deuterocanon", () => {
	it("parses Greek Daniel (DAG) including embedded Prayer of Azariah", () => {
		const r = parseUsfm(usfm("66-DAGeng-web.usfm"));
		expect(r?.bookCode).toBe("DanGr");
		// Prayer of Azariah is in chapter 3 of Greek Daniel
		const verse = r?.verses.find((v) => v.chapter === 3 && v.verse === 24);
		expect(verse).toBeDefined();
		expect(verse?.text.length).toBeGreaterThan(0);
	});

	it("parses Baruch including Letter of Jeremiah as chapter 6", () => {
		const r = parseUsfm(usfm("47-BAReng-web.usfm"));
		expect(r?.bookCode).toBe("Bar");
		const ch6 = r?.verses.find((v) => v.chapter === 6 && v.verse === 1);
		expect(ch6).toBeDefined();
		expect(ch6?.text).toContain("Jeremy"); // WEB renders the prophet's name "Jeremy" in the LJer letter
	});

	it("parses 1 Maccabees", () => {
		const r = parseUsfm(usfm("52-1MAeng-web.usfm"));
		expect(r?.bookCode).toBe("1Macc");
		expect(r?.verses.length).toBeGreaterThan(900);
	});
});

describe("parseUsfm — full bundle integrity", () => {
	it("parses all 81 books with no failures and produces only clean text", { timeout: 30_000 }, () => {
		const files = readdirSync(USFM_DIR).filter(
			(f) => f.endsWith(".usfm") && !f.startsWith("00-FRT") && !f.startsWith("106-GLO"),
		);
		expect(files.length).toBe(81);

		let totalVerses = 0;
		const failures: string[] = [];
		const dirty: { ref: string; sample: string }[] = [];

		for (const f of files) {
			const r = parseUsfm(usfm(f));
			if (!r) {
				failures.push(f);
				continue;
			}
			totalVerses += r.verses.length;
			for (const v of r.verses) {
				if (/\\[a-z]/.test(v.text) || v.text.includes("strong=")) {
					dirty.push({
						ref: `${v.bookCode} ${v.chapter}:${v.verse}`,
						sample: v.text.slice(0, 100),
					});
				}
			}
		}

		expect(failures).toEqual([]);
		expect(dirty).toEqual([]);
		// WEB ecumenical edition has roughly 38K verses (66 protestant ~31K + deuterocanon ~7K)
		expect(totalVerses).toBeGreaterThan(35000);
		expect(totalVerses).toBeLessThan(45000);
	});
});
