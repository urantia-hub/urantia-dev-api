import { describe, expect, it } from "bun:test";
import { bibleUrl, scriptureUrl, textFragment } from "../../src/lib/parallel-links.ts";

describe("the address of a Bible passage", () => {
	it("is the chapter page of the World English Bible, at the verse", () => {
		expect(bibleUrl("John", 17, 1)).toBe("https://ebible.org/eng-web/JHN17.htm#V1");
		expect(bibleUrl("Tob", 13, 4)).toBe("https://ebible.org/eng-web/TOB13.htm#V4");
	});

	it("writes a chapter with two digits, and a psalm with three", () => {
		expect(bibleUrl("Gen", 1, 1)).toBe("https://ebible.org/eng-web/GEN01.htm#V1");
		expect(bibleUrl("Ps", 51, 10)).toBe("https://ebible.org/eng-web/PSA051.htm#V10");
		expect(bibleUrl("Ps", 119, 105)).toBe("https://ebible.org/eng-web/PSA119.htm#V105");
	});

	it("knows the books that have another code on that site", () => {
		expect(bibleUrl("EsthGr", 1, 1)).toBe("https://ebible.org/eng-web/ESG01.htm#V1");
		expect(bibleUrl("DanGr", 13, 1)).toBe("https://ebible.org/eng-web/DAG13.htm#V1");
		expect(bibleUrl("AddPs", 1, 1)).toBe("https://ebible.org/eng-web/PS201.htm#V1");
		expect(bibleUrl("PrMan", 1, 1)).toBe("https://ebible.org/eng-web/MAN01.htm#V1");
		expect(bibleUrl("Sir", 18, 1)).toBe("https://ebible.org/eng-web/SIR18.htm#V1");
	});

	it("is null for a book that it does not know: no link is better than a wrong one", () => {
		expect(bibleUrl("Enoch", 1, 1)).toBeNull();
		expect(bibleUrl("Gen", 0, 1)).toBeNull();
		expect(bibleUrl("Gen", 1.5, 1)).toBeNull();
	});
});

describe("the words that take a browser to a passage", () => {
	it("are the first words, with each sign of the syntax encoded", () => {
		expect(textFragment("He who lives forever created the whole universe.")).toBe(
			"#:~:text=He%20who%20lives%20forever%20created",
		);
		expect(textFragment("Well-made, self-respect & more, and then some words")).toBe(
			"#:~:text=Well%2Dmade%2C%20self%2Drespect%20%26%20more%2C%20and",
		);
	});

	it("start after an opening quote mark, and stop before a line break", () => {
		expect(textFragment('"To die happy," he replied to the man')).toBe(
			"#:~:text=To%20die%20happy%2C%22%20he%20replied",
		);
		expect(textFragment("First line\nSecond line of the verse")).toBe("#:~:text=First%20line");
	});

	it("are empty for a text with no word", () => {
		expect(textFragment("   ")).toBe("");
	});
});

describe("the address of a passage of another work", () => {
	const text = "Make contentment and modesty thine earrings, self-respect thy wallet";

	it("is the page that holds the text, with the words of the passage", () => {
		expect(scriptureUrl("japji-macauliffe-1909", "Japji 28", text)).toBe(
			"https://en.wikisource.org/wiki/The_Sikh_Religion/Volume_1/Japji#:~:text=Make%20contentment%20and%20modesty%20thine",
		);
		expect(
			scriptureUrl("koran-pickthall-1930", "Quran 19.65-67", "Lord of the heavens and the earth"),
		).toBe(
			"https://www.gutenberg.org/cache/epub/16955/pg16955-images.html#:~:text=Lord%20of%20the%20heavens%20and",
		);
	});

	it("is the page of the discourse for the Bhagavad Gita", () => {
		expect(
			scriptureUrl("bhagavad-gita-besant-1922", "BG 7.22-24", "He endowed with that faith"),
		).toBe(
			"https://en.wikisource.org/wiki/Bhagavad-Gita_(Besant_4th)/Discourse_7#:~:text=He%20endowed%20with%20that%20faith",
		);
		expect(scriptureUrl("bhagavad-gita-besant-1922", "BG 18.49-51", "He whose Reason")).toContain(
			"/Discourse_18#",
		);
	});

	it("is null for a work that it does not know, and for a Gita reference with no discourse", () => {
		expect(scriptureUrl("unknown-work", "X 1", text)).toBeNull();
		expect(scriptureUrl("bhagavad-gita-besant-1922", "BG", text)).toBeNull();
	});

	it("knows each work that the API serves", () => {
		for (const id of [
			"diogenes-laertius-6-hicks-1925",
			"epictetus-3-22-oldfather-1928",
			"dhammapada-muller-1881",
			"bhagavad-gita-besant-1922",
			"shinto-oracles-aston-1905",
			"tao-te-ching-legge-1891",
			"analects-legge-1861",
			"koran-pickthall-1930",
			"japji-macauliffe-1909",
		]) {
			expect(scriptureUrl(id, "BG 1.1", text)).toStartWith("https://");
		}
	});
});
