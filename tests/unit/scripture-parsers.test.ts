import { describe, expect, it } from "bun:test";
import {
	fixMisprintedChapters,
	parseAnalects,
	parseBesantGita,
	parseDhammapada,
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
