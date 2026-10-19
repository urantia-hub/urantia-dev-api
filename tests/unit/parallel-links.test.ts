import { describe, expect, it } from "bun:test";
import { CORPORA } from "../../scripts/scriptures/corpora.ts";
import { bibleUrl, scriptureUrl, textFragment, workPage } from "../../src/lib/parallel-links.ts";

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

	it("gets the page only for the Book of the Dead, whose repeated chapters share their words", () => {
		expect(
			scriptureUrl(
				"book-of-the-dead-renouf-1904",
				"BD 64.5",
				"Oh Râ, who smileth cheerfully, and whose heart is delighted with the perfect order of this day, as thou enterest into Heaven and comest forth in the East, the Ancients and those who are gone before acclaim thee.",
			),
		).toBe("https://www.gutenberg.org/cache/epub/69566/pg69566-images.html");
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

	it("is the page of the hymn for the Rig Veda", () => {
		expect(
			scriptureUrl("rig-veda-griffith-1896", "RV 10.129.1-3", "THEN was not non-existent"),
		).toBe(
			"https://en.wikisource.org/wiki/The_Hymns_of_the_Rigveda/Book_10/Hymn_129#:~:text=THEN%20was%20not%20non%2Dexistent",
		);
		for (const reference of ["RV 10", "RV 11.1.1", "RV 1.0.1"])
			expect(scriptureUrl("rig-veda-griffith-1896", reference, "x")).toBeNull();
	});

	it("is the reading page of Project Gutenberg for the works of batch 2", () => {
		for (const [id, pg] of [
			["book-of-the-dead-renouf-1904", 69566],
			["hesiod-evelyn-white-1914", 348],
			["homeric-hymns-evelyn-white-1914", 348],
			["poetic-edda-bellows-1923", 73533],
			["aztec-hymns-brinton-1890", 14993],
			["chuang-tzu-giles-1889", 59709],
		] as const) {
			expect(workPage(id, "X 1.1")).toBe(
				`https://www.gutenberg.org/cache/epub/${pg}/pg${pg}-images.html`,
			);
		}
	});

	it("is the Wikisource page of the section, part, book, or Upanishad for the works of batch 2", () => {
		const ws = "https://en.wikisource.org/wiki/";
		expect(workPage("kojiki-chamberlain-1882", "Kojiki 4.2")).toBe(
			`${ws}Kojiki_(Chamberlain,_1882)/Section_4`,
		);
		expect(workPage("prose-edda-brodeur-1916", "Gylfaginning 34.2")).toBe(
			`${ws}The_Prose_Edda_(1916_translation_by_Arthur_Gilchrist_Brodeur)/Gylfaginning`,
		);
		expect(workPage("prose-edda-brodeur-1916", "Skáldskaparmál 3.1")).toBe(
			`${ws}The_Prose_Edda_(1916_translation_by_Arthur_Gilchrist_Brodeur)/Sk%C3%A1ldskaparm%C3%A1l`,
		);
		expect(workPage("upanishads-muller-1879", "Khandogya 6.8")).toBe(
			`${ws}Sacred_Books_of_the_East/Volume_1/Kh%C3%A2ndogya-upanishad/Sixth_Prap%C3%A2thaka`,
		);
		expect(workPage("upanishads-muller-1879", "Kena 1.3")).toBe(
			`${ws}Sacred_Books_of_the_East/Volume_1/Talavak%C3%A2ra-upanishad`,
		);
		expect(workPage("upanishads-muller-1879", "Isa 6")).toBe(
			`${ws}Sacred_Books_of_the_East/Volume_1/V%C3%A2gasaneyi-samhit%C3%A2-upanishad`,
		);
		expect(workPage("shu-king-legge-1879", "Shu 2.1.3")).toBe(
			`${ws}Sacred_Books_of_the_East/Volume_3/The_Shu/Part_2/Book_1`,
		);
	});

	it("is null for a ref of batch 2 that it cannot place on one page", () => {
		expect(workPage("kojiki-chamberlain-1882", "Kojiki 181.1")).toBeNull();
		expect(workPage("prose-edda-brodeur-1916", "Hattatal 1.1")).toBeNull();
		expect(workPage("upanishads-muller-1879", "Khandogya 9.1")).toBeNull();
		expect(workPage("shu-king-legge-1879", "Shu 2.5.1")).toBeNull();
		// A book with sections: our paragraph numbers run on through its sections, so the page is unknown.
		expect(workPage("shu-king-legge-1879", "Shu 4.5.3")).toBeNull();
	});

	it("has a page for each work with a link, and none for a work with no link", () => {
		// A stored ref of a work with named divisions starts with the name ("Prologue 1.1").
		const first = (c: (typeof CORPORA)[number]) =>
			c.divisionNames?.[0]?.split("|")[0] ?? c.refPrefix;
		for (const c of CORPORA) expect(workPage(c.id, `${first(c)} 1.1.1`) !== null).toBe(c.linked);
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
