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

describe("a number at the start of a passage", () => {
	it("is the count of a part in our record, and is not in the words", () => {
		expect(textFragment("1. Or fame or life, Which do you hold more dear?")).toBe(
			"#:~:text=Or%20fame%20or%20life%2C%20Which",
		);
	});
});

describe("a page that holds a whole book", () => {
	const long =
		"Lo! We, only We, inherit the earth and all who are thereon, and unto Us they are returned. And make mention (O Muhammad) in the Scripture of Abraham.";

	it("gets many words, because many verses start with the same few", () => {
		const url = scriptureUrl("koran-pickthall-1930", "Quran 19.40-43", long) as string;
		expect(url).toStartWith(
			"https://www.gutenberg.org/cache/epub/16955/pg16955-images.html#:~:text=Lo!%20We%2C%20only%20We%2C",
		);
		expect(decodeURIComponent(url.split("#:~:text=")[1] as string).split(" ")).toHaveLength(24);
	});

	it("gets the page only for a passage that is too short to be sure of", () => {
		expect(
			scriptureUrl("koran-pickthall-1930", "Quran 1.1", "Lord of the heavens and the earth"),
		).toBe("https://www.gutenberg.org/cache/epub/16955/pg16955-images.html");
		expect(
			scriptureUrl(
				"analects-legge-1861",
				"Analects 2.2",
				"The Master said, 'The superior man is catholic.'",
			),
		).toBe("https://www.gutenberg.org/cache/epub/4094/pg4094-images.html");
	});

	it("gets the page only when no number of words was sure", () => {
		expect(
			scriptureUrl(
				"dhammapada-muller-1881",
				"Dhp 122-123",
				"Let no man think lightly of good, saying in his heart, It will not come nigh unto me.",
			),
		).toBe("https://www.gutenberg.org/cache/epub/2017/pg2017-images.html");
	});
});

describe("the address of a passage of another work", () => {
	const text = "Make contentment and modesty thine earrings, self-respect thy wallet";

	it("is the page that holds the text, with the words of the passage", () => {
		expect(scriptureUrl("japji-macauliffe-1909", "Japji 28", text)).toBe(
			"https://en.wikisource.org/wiki/The_Sikh_Religion/Volume_1/Japji#:~:text=Make%20contentment%20and%20modesty%20thine",
		);
		expect(
			scriptureUrl(
				"tao-te-ching-legge-1891",
				"TTC 44",
				"1. Or fame or life, Which do you hold more dear? Or life or wealth",
			),
		).toBe(
			"https://www.gutenberg.org/cache/epub/216/pg216-images.html#:~:text=Or%20fame%20or%20life%2C%20Which%20do%20you%20hold%20more%20dear%3F",
		);
	});

	it("is the page of the discourse for the Bhagavad Gita, for a discourse that exists", () => {
		expect(
			scriptureUrl("bhagavad-gita-besant-1922", "BG 7.22-24", "He endowed with that faith"),
		).toBe(
			"https://en.wikisource.org/wiki/Bhagavad-Gita_(Besant_4th)/Discourse_7#:~:text=He%20endowed%20with%20that%20faith",
		);
		expect(scriptureUrl("bhagavad-gita-besant-1922", "BG 18.49-51", "He whose Reason")).toContain(
			"/Discourse_18#",
		);
		for (const reference of ["BG", "BG 0.1", "BG 19.1", "BG 07.1"])
			expect(scriptureUrl("bhagavad-gita-besant-1922", reference, text)).toBeNull();
	});

	it("is null for a work that it does not know", () => {
		expect(scriptureUrl("unknown-work", "X 1", text)).toBeNull();
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

describe("a stored anchor", () => {
	it("is the words of the link, in place of the rule of the work", () => {
		expect(
			scriptureUrl(
				"dhammapada-muller-1881",
				"Dhp 122-123",
				"Let no man think lightly of good",
				"Let no man think lightly of good,",
			),
		).toBe(
			"https://www.gutenberg.org/cache/epub/2017/pg2017-images.html#:~:text=Let%20no%20man%20think%20lightly%20of%20good%2C",
		);
		expect(
			scriptureUrl(
				"japji-macauliffe-1909",
				"Japji 28",
				"Make contentment and modesty thine earrings",
				"well-made words",
			),
		).toContain("#:~:text=well%2Dmade%20words");
	});

	it("changes nothing when it is absent", () => {
		expect(scriptureUrl("dhammapada-muller-1881", "Dhp 1", "All that we are", null)).toBe(
			"https://www.gutenberg.org/cache/epub/2017/pg2017-images.html",
		);
	});
});
