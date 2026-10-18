import { describe, expect, it } from "bun:test";
import { normalizeQuery, parsePaperRef, toTsQuery, workHint } from "../../src/lib/search-text.ts";

describe("normalizeQuery", () => {
	it("makes curly quotes plain and reads a quoted query as a phrase", () => {
		expect(normalizeQuery("“Amadon”")).toEqual({ text: "amadon", words: ["amadon"], quoted: true });
		expect(normalizeQuery('"this is death"').quoted).toBe(true);
		expect(normalizeQuery("this is death").quoted).toBe(false);
	});

	it("joins the digits of a number with commas", () => {
		expect(normalizeQuery("9,881").text).toBe("9881");
		expect(normalizeQuery("1,000,000 worlds").text).toBe("1000000 worlds");
	});

	it("splits a hyphen word into its parts and drops apostrophes", () => {
		expect(normalizeQuery("self-mastery").words).toEqual(["self", "mastery"]);
		expect(normalizeQuery("God’s will").text).toBe("gods will");
	});

	it("leaves no character that has a meaning in a tsquery", () => {
		expect(normalizeQuery("a & b | !c:* 'd' \\e (f)").text).toBe("a b c d e f");
		expect(normalizeQuery("&&& !!!").words).toEqual([]);
	});
});

describe("toTsQuery", () => {
	it("joins the words, with the last word as a prefix when asked", () => {
		expect(toTsQuery(["mind", "matter", "spi"], "&", true)).toBe("mind & matter & spi:*");
		expect(toTsQuery(["love", "god"], "|", false)).toBe("love | god");
		expect(toTsQuery([], "&", true)).toBe("");
	});
});

describe("parsePaperRef", () => {
	it("reads a paragraph, a section, and a paper", () => {
		expect(parsePaperRef("68:6.3")).toEqual({ paperId: "68", sectionId: "6", paragraphId: "3" });
		expect(parsePaperRef('"103:2.1"')).toEqual({
			paperId: "103",
			sectionId: "2",
			paragraphId: "1",
		});
		expect(parsePaperRef("68:6")).toEqual({ paperId: "68", sectionId: "6" });
		expect(parsePaperRef("68:6.")).toEqual({ paperId: "68", sectionId: "6" });
		expect(parsePaperRef("68:")).toEqual({ paperId: "68" });
		expect(parsePaperRef("68")).toEqual({ paperId: "68" });
		expect(parsePaperRef("Paper 68")).toEqual({ paperId: "68" });
		expect(parsePaperRef("0:0.1")).toEqual({ paperId: "0", sectionId: "0", paragraphId: "1" });
	});

	it("reads the other forms of a paragraph id", () => {
		expect(parsePaperRef("4:68.6.3")).toEqual({ paperId: "68", sectionId: "6", paragraphId: "3" });
		expect(parsePaperRef("68.6.3")).toEqual({ paperId: "68", sectionId: "6", paragraphId: "3" });
	});

	it("is null for a number that is not a paper, and for words", () => {
		expect(parsePaperRef("197")).toBeNull();
		expect(parsePaperRef("873")).toBeNull();
		expect(parsePaperRef("197:1.1")).toBeNull();
		expect(parsePaperRef("jesus 15")).toBeNull();
		expect(parsePaperRef("")).toBeNull();
	});
});

describe("workHint", () => {
	it("names a work for its name or one of its references", () => {
		expect(workHint("dhammapada")?.work).toBe("dhammapada");
		expect(workHint("Tao-Teh-King")?.work).toBe("tao-te-ching");
		expect(workHint("bhagavad gita")?.work).toBe("bhagavad-gita");
		expect(workHint("qur'an")?.work).toBe("quran");
		expect(workHint("Dhp 183")?.work).toBe("dhammapada");
		expect(workHint("BG 2.47")?.work).toBe("bhagavad-gita");
	});

	it("names the Bible for a Bible reference", () => {
		expect(workHint("John 3:16")?.work).toBe("bible");
		expect(workHint("Jn 3:16-18")?.work).toBe("bible");
		expect(workHint("Matthew 5")?.work).toBe("bible");
		expect(workHint("bible")?.work).toBe("bible");
	});

	it("is null for words of the Papers", () => {
		expect(workHint("soul")).toBeNull();
		expect(workHint("john")).toBeNull();
		expect(workHint("68:6.3")).toBeNull();
		expect(workHint("confucius")).toBeNull();
	});
});
