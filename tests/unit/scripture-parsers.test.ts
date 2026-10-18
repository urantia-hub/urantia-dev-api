import { describe, expect, it } from "bun:test";
import {
	fixMisprintedChapters,
	parseAnalects,
	parseBesantGita,
	parseBookOfMormon,
	parseDhammapada,
	parseGriffithRigVeda,
	parseJapji,
	parseTaoTeChing,
	romanToInt,
} from "../../scripts/scriptures/parsers.ts";

const wrap = (body: string) =>
	`header\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n${body}\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nlicense`;

describe("romanToInt", () => {
	it("reads chapter numerals", () => {
		expect([romanToInt("I"), romanToInt("IV"), romanToInt("XIV"), romanToInt("XXVI")]).toEqual([
			1, 4, 14, 26,
		]);
	});
});

describe("parseDhammapada", () => {
	it("numbers verses, joins wrapped lines, and keeps a printed pair as one passage", () => {
		const ps = parseDhammapada(
			wrap(
				"Intro 1. not a verse\nChapter I. The Twin-Verses\n\n1. All that we are\nis the result.\n\n58, 59. As on a heap\nof rubbish.",
			),
		);
		expect(ps.map((p) => [p.ref, p.text, p.divisionTitle])).toEqual([
			["Dhp 1", "All that we are is the result.", "The Twin-Verses"],
			["Dhp 58-59", "As on a heap of rubbish.", "The Twin-Verses"],
		]);
	});
});

describe("parseTaoTeChing", () => {
	it("reads chapters with numbered paragraphs, and a chapter of one paragraph", () => {
		const ps = parseTaoTeChing(
			wrap(
				"PART 1.\n\nCh. 1. 1. The Tao that can be trodden\nis not the Tao.\n\n2. Having no name.\n\n2. 1. All in the world\nknow beauty.\n\n3. The thirty spokes unite.",
			),
		);
		expect(ps.map((p) => p.ref)).toEqual(["TTC 1.1", "TTC 1.2", "TTC 2.1", "TTC 3.1"]);
		expect(ps[0]?.text).toBe("The Tao that can be trodden is not the Tao.");
	});
});

describe("parseAnalects", () => {
	it("drops Chinese lines and sentence numbers, and reads CHAP with or without a period", () => {
		const ps = parseAnalects(
			wrap(
				"BOOK I.  HSIO R.\n【第一章】學而時習之\n        CHAPTER I. 1. The Master said, 'Is it not\npleasant to learn?'\n        2. 'Is it not delightful?'\n        CHAP II. The philosopher said.",
			),
		);
		expect(ps.map((p) => [p.ref, p.text])).toEqual([
			["Analects 1.1", "The Master said, 'Is it not pleasant to learn?' 'Is it not delightful?'"],
			["Analects 1.2", "The philosopher said."],
		]);
	});
});

describe("fixMisprintedChapters", () => {
	const p = (ref: string) => ({
		ref,
		sort: 0,
		division: ref.split(" ")[1]?.split(".")[0] ?? "",
		divisionTitle: null,
		text: "x",
	});
	it("repairs a misprint between two correct numbers, and a repeat at the end of a book", () => {
		const refs = [
			"Analects 2.16",
			"Analects 2.17",
			"Analects 2.17",
			"Analects 2.19",
			"Analects 3.22",
			"Analects 3.32",
			"Analects 3.24",
			"Analects 14.46",
			"Analects 14.46",
		];
		expect(fixMisprintedChapters(refs.map(p)).map((x) => x.ref)).toEqual([
			"Analects 2.16",
			"Analects 2.17",
			"Analects 2.18",
			"Analects 2.19",
			"Analects 3.22",
			"Analects 3.23",
			"Analects 3.24",
			"Analects 14.46",
			"Analects 14.47",
		]);
	});
});

describe("parseBesantGita", () => {
	it("takes the verse number from the Sanskrit and the English up to the next Sanskrit", () => {
		const html =
			"<p>धर्मक्षेत्रे ॥ १ ॥ Dhritarashtra said: On the holy plain, &#91; 1 &#93; what did they do? (1)</p>" +
			"<p>दृष्ट्वा ॥ २ ॥ Sanjaya said: Having seen the army (3)</p>" +
			"<p>मूढ ॥ ३ ॥ That austerity done under a deluded understanding. (3 &#160;</p>" +
			"<p>तत् ॥ ४ ॥ That Reason is of darkness. 4)</p>" +
			"<p>इति ॥ १ ॥ Thus in the glorious Upanishads of the Bhagavad-Gita, the first discourse.</p>";
		expect(parseBesantGita({ "1": html }).map((p) => [p.ref, p.text])).toEqual([
			["BG 1.1", "Dhritarashtra said: On the holy plain, what did they do?"],
			["BG 1.2", "Sanjaya said: Having seen the army"],
			["BG 1.3", "That austerity done under a deluded understanding."],
			["BG 1.4", "That Reason is of darkness."],
		]);
	});
});

describe("parseJapji", () => {
	it("reads every pauri, including a numeral outside the centered box", () => {
		const box = (n: string) => `<div class="wst-center tiInherit"><p>${n}\n</p></div>`;
		const html = `<p>THE JAPJI There is but one God.</p>${box("I")}<p>First pauri.</p>${box("XXXII")}<p>Thirty-second.</p><p>XXXIII\n</p><p>Thirty-third.</p>${box("SLOK")}<p>Closing.</p>`;
		const ps = parseJapji(html);
		expect(ps.map((p) => p.ref)).toEqual([
			"Japji 0",
			"Japji 1",
			"Japji 32",
			"Japji 33",
			"Japji 39",
		]);
		expect(ps[0]?.text).toBe("There is but one God.");
		expect(ps[2]?.text).toBe("Thirty-second.");
	});
});

describe("parseBookOfMormon", () => {
	const START = "*** START OF THE PROJECT GUTENBERG EBOOK THE BOOK OF MORMON ***\n\n";
	const END = "\n\n*** END OF THE PROJECT GUTENBERG EBOOK THE BOOK OF MORMON ***\n";
	const nephi = `THE FIRST BOOK OF NEPHI HIS REIGN AND MINISTRY (1 Nephi)

An account of Lehi and his wife Sariah and his four sons.

1 Nephi Chapter 1

1:1 I, Nephi, having been born of goodly parents, therefore I was
taught somewhat in all the learning of my father.

1:2 Yea, I make a record in the language of my father. 1:3 And I know
that the record which I make is true.

1 Nephi Chapter 2

2:1 For behold, it came to pass that the Lord spake unto my father.`;

	it("numbers each verse by its book, chapter, and verse, and drops the book's introduction", () => {
		const p = parseBookOfMormon(START + nephi + END);
		expect(p.map((x) => x.ref)).toEqual([
			"1 Nephi 1:1",
			"1 Nephi 1:2",
			"1 Nephi 1:3",
			"1 Nephi 2:1",
		]);
		expect(p[0]?.text).toBe(
			"I, Nephi, having been born of goodly parents, therefore I was taught somewhat in all the learning of my father.",
		);
		expect(p[1]?.text).toBe("Yea, I make a record in the language of my father.");
		expect(p.some((x) => x.text.includes("An account of Lehi"))).toBe(false);
		expect(p[3]).toMatchObject({ division: "1", subdivision: 2, divisionTitle: "1 Nephi" });
	});

	it("starts the next book at its verse 1:1, and reads a verse marker with a book name", () => {
		const second = `\n\n THE SECOND BOOK OF NEPHI\n\nAn account of the death of Lehi.\n\n2 Nephi Chapter 1\n\n1:1 And now it came to pass that after I, Nephi, had made an end. 2 Nephi 1:2 And he spake.`;
		const p = parseBookOfMormon(START + nephi + second + END);
		expect(p.at(-2)?.ref).toBe("2 Nephi 1:1");
		expect(p.at(-2)?.text).toBe("And now it came to pass that after I, Nephi, had made an end.");
		expect(p.at(-1)).toMatchObject({ ref: "2 Nephi 1:2", text: "And he spake.", division: "2" });
	});

	it("stops the build on a verse out of order", () => {
		const bad = nephi.replace("1:3 And I know", "1:4 And I know");
		expect(() => parseBookOfMormon(START + bad + END)).toThrow(/1 Nephi 1:4/);
	});
});

describe("parseGriffithRigVeda", () => {
	const plain = `<div class="verse"><pre>1. THE chanters hymn thee, they who say the word of praise magnify thee.
     The priests have raised thee up on high, O Satakratu, like a pole.
2. As up he clomb from ridge to ridge and looked upon the toilsome task,
     Indra observes this wish of his, and the Rain hastens with his troop.
</pre></div>`;
	const proofread = `<div class="wst-rh-cell wst-rh-center">HYMN I.<sup id="cite&#95;ref-1" class="reference"><a href="#cite_note-1"><span class="cite-bracket">&#91;</span>1<span class="cite-bracket">&#93;</span></a></sup></div><div class="wst-rh-cell wst-rh-right">Agni.</div></div>
<div class="ws-poem ws-poem-hi ws-poem-left-gutter"><div class="ws-poem-stanza" role="paragraph"><span class="ws-poem-line"><span class="smallcaps" style="font-variant:small-caps;">I laud</span> Agni, the chosen Priest, God, minister of sacrifice,<span class="ws-poem-break"><br /></span></span><span class="ws-poem-line">The Hotar, lavishest of wealth.<span class="ws-poem-break"><br /></span></span><span class="ws-poem-break"><br /></span></div><div class="ws-poem-stanza" role="paragraph"><span class="ws-poem-versenum">2 </span><span class="ws-poem-line">Worthy is Agni to be praised by living as by ancient seers:<sup id="cite&#95;ref-2" class="reference"><a href="#cite_note-2"><span class="cite-bracket">&#91;</span>2<span class="cite-bracket">&#93;</span></a></sup><span class="ws-poem-break"><br /></span></span><span class="ws-poem-line">He shall bring hitherward the Gods.<span class="ws-poem-break"><br /></span></span><span class="ws-poem-break"><br /></span></div></div>
<div class="reflist"><ol class="references"><li id="cite_note-1"><span class="reference-text">Agni: the God of Fire.</span></li></ol></div>`;
	const noteOnly = `<div class="verse"><pre>     (The following Hymn was originally only found in the Appendix, with certain lines translated in Latin.--JBH.)
</pre></div>`;

	it("numbers each verse by book, hymn, and verse, with the text as printed", () => {
		const p = parseGriffithRigVeda({ "1.10": plain });
		expect(p.map((x) => x.ref)).toEqual(["RV 1.10.1", "RV 1.10.2"]);
		expect(p[0]?.text).toBe(
			"THE chanters hymn thee, they who say the word of praise magnify thee. The priests have raised thee up on high, O Satakratu, like a pole.",
		);
		expect(p[1]).toMatchObject({ division: "1", subdivision: 10, divisionTitle: null });
	});

	it("reads a proofread page: verse 1 has no number, the notes go, and the hymn title is kept", () => {
		const p = parseGriffithRigVeda({ "1.1": proofread });
		expect(p.map((x) => x.ref)).toEqual(["RV 1.1.1", "RV 1.1.2"]);
		expect(p[0]?.text).toBe(
			"I laud Agni, the chosen Priest, God, minister of sacrifice, The Hotar, lavishest of wealth.",
		);
		expect(p[1]?.text).toBe(
			"Worthy is Agni to be praised by living as by ancient seers: He shall bring hitherward the Gods.",
		);
		expect(p[0]?.divisionTitle).toBe("Agni");
	});

	const pre = (lines: string) => `<div class="verse"><pre>${lines}\n</pre></div>`;

	it("reads a verse number with no dot, and verse 1 that the scan printed as 'I.'", () => {
		const p = parseGriffithRigVeda({
			"1.73": pre(
				"     I. HE who gives food, like patrimonial riches\n     Loved like a guest\n2 Like the God Savitar\n     He bringeth gain\n3 Like a God, Ruler",
			),
		});
		expect(p.map((x) => x.ref)).toEqual(["RV 1.73.1", "RV 1.73.2", "RV 1.73.3"]);
		expect(p[0]?.text).toBe("HE who gives food, like patrimonial riches Loved like a guest");
	});

	it("puts a misprinted number right when the next number shows it", () => {
		const p = parseGriffithRigVeda({ "1.91": pre("16. A.\n17. B.\n16. C.\n19. D.") });
		expect(p.map((x) => x.ref)).toEqual(["RV 1.91.16", "RV 1.91.17", "RV 1.91.18", "RV 1.91.19"]);
	});

	it("gives two numbers to a verse that holds the next one, when the source left a number out", () => {
		const p = parseGriffithRigVeda({
			"10.48": pre(
				"5. A.\n     a.\n6. These, breathing loud.\n     The challengers.\n     This One by stronger might.\n     Like many sheaves.\n8. Against the Gungus.\n     When I won glory.",
			),
		});
		expect(p.map((x) => x.ref)).toEqual(["RV 10.48.5", "RV 10.48.6-7", "RV 10.48.8"]);
	});

	it("keeps a gap where Griffith left verses out: the verse before it is not longer than the others", () => {
		const p = parseGriffithRigVeda({
			"10.61": pre(
				"3. To his oblations.\n     With arrows.\n4. I call on you.\n     Enjoy my sacrifice.\n10. Uttering praise.\n     They who approached.",
			),
		});
		expect(p.map((x) => x.ref)).toEqual(["RV 10.61.3", "RV 10.61.4", "RV 10.61.10"]);
	});

	it("reads the other layouts: lines in a paragraph, no space after the dot, an indented number", () => {
		const para = `<p>1. A THOUSAND heads hath Purusa, a thousand eyes, a thousand feet.<br />
<span class="wst-gap __gap" style="display:inline-block; inline-size:2em"></span>On every side pervading earth he fills a space ten fingers wide.<br />
2. This Purusa is all that yet hath been and all that is to be;<br />
</p>`;
		expect(parseGriffithRigVeda({ "10.90": para }).map((x) => x.text)).toEqual([
			"A THOUSAND heads hath Purusa, a thousand eyes, a thousand feet. On every side pervading earth he fills a space ten fingers wide.",
			"This Purusa is all that yet hath been and all that is to be;",
		]);
		expect(
			parseGriffithRigVeda({ "2.10": pre("1.AGNI, first, loudly calling.\n2. Mark.") })[0]?.text,
		).toBe("AGNI, first, loudly calling.");
		expect(
			parseGriffithRigVeda({ "2.22": pre("     1. At the Trikadrukas.\n2. He.") })[0]?.ref,
		).toBe("RV 2.22.1");
	});

	it("takes the text before verse 2 as verse 1 when its number is missing, without the scan's 'I'", () => {
		const p = parseGriffithRigVeda({
			"1.53": pre("     I WE will present fair praise.\n     For he hath.\n2. Giver of horses."),
		});
		expect(p.map((x) => [x.ref, x.text])).toEqual([
			["RV 1.53.1", "WE will present fair praise. For he hath."],
			["RV 1.53.2", "Giver of horses."],
		]);
	});

	it("keeps no editor's note as a verse, and orders the hymns by number", () => {
		expect(parseGriffithRigVeda({ "1.179": noteOnly })).toEqual([]);
		const p = parseGriffithRigVeda({ "1.10": plain, "1.2": plain });
		expect(p.map((x) => x.ref).slice(0, 2)).toEqual(["RV 1.2.1", "RV 1.2.2"]);
		expect(p[0]?.sort).toBeLessThan(p[2]?.sort as number);
	});
});
