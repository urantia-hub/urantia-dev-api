import { describe, expect, it } from "bun:test";
import {
	fixMisprintedChapters,
	parseAnalects,
	parseBellowsEdda,
	parseBesantGita,
	parseBookOfMormon,
	parseBrintonHymns,
	parseBrodeurProseEdda,
	parseChamberlainKojiki,
	parseDhammapada,
	parseGilesChuangTzu,
	parseGriffithRigVeda,
	parseHesiod,
	parseHomericHymns,
	parseJapji,
	parseLeggeShuKing,
	parseMullerUpanishads,
	parseRenoufBookOfTheDead,
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

	it("drops a link to the errata that the page prints as text, and keeps its word", () => {
		const errata = `<div class="verse"><pre>1. LET guardians hasting hear with favour the song of Angiras's pious
     &lt;A HREF="errata.htm#0"&gt;children&lt;/A&gt;?
2. When to the people of the home he cometh he strides in strength.
</pre></div>`;
		const p = parseGriffithRigVeda({ "1.121": errata });
		expect(p[0]?.text).toBe(
			"LET guardians hasting hear with favour the song of Angiras's pious children?",
		);
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

describe("parseHesiod and parseHomericHymns", () => {
	// Project Gutenberg #348 (Evelyn-White, 1914), with its CRLF line ends.
	const raw = wrap(`HESIOD’S WORKS AND DAYS

(ll. 1-10) Muses of Pieria who give glory through song, come hither,
tell of Zeus your father and chant his praise.

Attend thou with eye and ear, and make judgements straight with
righteousness. And I, Perses, would tell of true things.

(ll 11-24) So, after all, there was not one kind of Strife alone, but
all over the earth there are two.

THE DIVINATION BY BIRDS

Fragment #1—Proclus on Works and Days, 828: Some make the Divination by Birds.

THE THEOGONY

(ll. 1-25) From the Heliconian Muses let us begin to sing, and reverend Themis and
quick-glancing 1601 Aphrodite, and Hebe with the crown of gold.

(ll. 26-28) ‘Shepherds of the wilderness, wretched things of shame,
mere bellies.’
1602

(ll. 929a-929t) 1630 But Hera was very angry and quarrelled with her
mate. And there are shining gates grown of itself 1625. {[0-9]} (ll. 930-933) And of Amphitrite.

THE CATALOGUES OF WOMEN AND EOIAE1701

Fragment #1—Scholiast on Apollonius Rhodius.

THE HOMERIC HYMNS




I. TO DIONYSUS 2501

*    *    *    *


(ll. 1-9) For some say, at Dracanum; and some, in Naxos, O Heaven-born, Insewn 2502; and others by the
deep-eddying river Alpheus.

III. TO DELIAN APOLLO

(ll. 1-18) I will remember and not be unmindful of Apollo.

TO PYTHIAN APOLLO—

(ll. 179-181) O Lord, Lycia is yours.

IV. TO HERMES

(ll. 1-29) He chose a stout laurel branch and trimmed it with the knife.... ((LACUNA)) 2516 ....held firmly in his hand.

XXIII. TO THE SON OF CRONOS, MOST HIGH

(l. 1) I will sing of Zeus, chiefest among the gods.

HOMER’S EPIGRAMS2601

I. (5 lines) (ll. 1-5) Have reverence for him who needs a home.`).replace(/\n/g, "\r\n");

	it("cuts the two poems into passages at their Greek line numbers, with no footnote marks", () => {
		const p = parseHesiod(raw);
		expect(p.map((x) => x.ref)).toEqual([
			"Theogony 1-25",
			"Theogony 26-28",
			"Theogony 929",
			"Theogony 930-933",
			"Works and Days 1-10",
			"Works and Days 11-24",
		]);
		expect(p[0]?.text).toBe(
			"From the Heliconian Muses let us begin to sing, and reverend Themis and quick-glancing Aphrodite, and Hebe with the crown of gold.",
		);
		expect(p[2]?.text).toBe(
			"But Hera was very angry and quarrelled with her mate. And there are shining gates grown of itself.",
		);
		expect(p[4]?.text).toBe(
			"Muses of Pieria who give glory through song, come hither, tell of Zeus your father and chant his praise. Attend thou with eye and ear, and make judgements straight with righteousness. And I, Perses, would tell of true things.",
		);
		expect(p[4]?.divisionTitle).toBe("Works and Days");
		expect(p.some((x) => /Fragment|Scholiast|\d{4}/.test(x.text))).toBe(false);
	});

	it("numbers the hymns by their Roman numeral and drops the gap marks and the sub-headings", () => {
		const p = parseHomericHymns(raw);
		expect(p.map((x) => x.ref)).toEqual([
			"HH 1.1-9",
			"HH 3.1-18",
			"HH 3.179-181",
			"HH 4.1-29",
			"HH 23.1",
		]);
		expect(p.map((x) => x.divisionTitle)).toEqual([
			"To Dionysus",
			"To Delian Apollo",
			"To Delian Apollo",
			"To Hermes",
			"To the Son of Cronos, Most High",
		]);
		expect(p[0]?.text).toBe(
			"For some say, at Dracanum; and some, in Naxos, O Heaven-born, Insewn; and others by the deep-eddying river Alpheus.",
		);
		expect(p[3]?.text).toBe(
			"He chose a stout laurel branch and trimmed it with the knife........held firmly in his hand.",
		);
	});
});

describe("parseBellowsEdda", () => {
	// Project Gutenberg #73533 (Bellows, 1923).
	const raw = wrap(`VOLUSPO

THE WISE-WOMAN’S PROPHECY


INTRODUCTORY NOTE

At the beginning of the collection in the Codex Regius stands the
Voluspo.





1.  Hearing I ask   |   from the holy races,
    From Heimdall’s sons,   |   both high and low;

2.  I remember yet   |   the giants of yore,
    Who gave me bread   |   in the days gone by;








NOTES

1. A few editors, following Bugge, in an effort to clarify the poem.

2. Giants: the giants were the oldest.




VAFTHRUTHNISMOL

THE BALLAD OF VAFTHRUTHNIR


INTRODUCTORY NOTE

The poem is a contest of wisdom, composed about the year
1050. As to its state of preservation there is some dispute.




It has been much discussed by Bugge.





I. THE WAGER





Othin spake:


1.  “Counsel me, Frigg,   |   for I long to fare,
      And Vafthruthnir fain would find;

Frigg spake:


2.  “Heerfather here   |   at home would I keep,
      Where the gods together dwell.”

Then Othin went to the hall.




 NOTES

1. Frigg: Othin's wife.




DRAP NIFLUNGA

THE SLAYING OF THE NIFLUNGS


INTRODUCTORY NOTE

The short prose passage entitled Drap Niflunga.





Gunnar and Hogni then took all the gold that Fafnir had had.

King Atli invited Gunnar and Hogni to come to him.








NOTE


Prose. Niflungs: regarding the mistaken application of this name.`);

	it("numbers each stanza in its poem and stops at each notes heading", () => {
		const p = parseBellowsEdda(raw);
		expect(p.map((x) => x.ref)).toEqual([
			"Voluspo 1",
			"Voluspo 2",
			"Vafthruthnismol 1",
			"Vafthruthnismol 2",
			"Drap Niflunga 1",
			"Drap Niflunga 2",
		]);
		expect(p[0]?.text).toBe(
			"Hearing I ask from the holy races, From Heimdall’s sons, both high and low;",
		);
		expect(
			p.some((x) => /Bugge|Giants:|Othin's wife|Niflungs:|Codex Regius|contest/.test(x.text)),
		).toBe(false);
	});

	it("puts the manuscript's prose before the stanza it leads into, and the closing prose after the last", () => {
		const p = parseBellowsEdda(raw);
		expect(p[2]?.text).toBe(
			"Othin spake: “Counsel me, Frigg, for I long to fare, And Vafthruthnir fain would find;",
		);
		expect(p[3]?.text).toBe(
			"Frigg spake: “Heerfather here at home would I keep, Where the gods together dwell.” Then Othin went to the hall.",
		);
		expect(p[4]?.text).toBe("Gunnar and Hogni then took all the gold that Fafnir had had.");
		expect(p[2]?.divisionTitle).toBe("The Ballad of Vafthruthnir");
	});
});

describe("parseRenoufBookOfTheDead", () => {
	// Project Gutenberg #69566 (Renouf and Naville, 1904).
	const raw = wrap(`                           BOOK OF THE DEAD.




                               CHAPTER I.

(1.)_The Beginning of the Chapters of Coming forth by Day, of the_
  (2.)_Words which bring about Resurrection and Glory. Said upon the Day of Burial of_ N, _the
  Victorious,_(3.) _who entereth after coming forth_.(4.) _Here is_ N
  _the Victorious. He saith_—


O (5.)Bull of Amenta, It is Thoth, the everlasting King, who is here.

I am the great god in the Bark, who have fought for thee.

PLATE I.

                           BOOK OF THE DEAD.

[Illustration:

  CHAPTER I.
  Papyrus in the British Museum.
]

I am with Horus on the day of covering (11.)Teshtesh.

                                 NOTES.

1. The title here translated is that usual in all the papyri.

                  ------------------------------------




                              CHAPTER XXXB.

       _Chapter whereby the heart of a person is not kept back from him in the Netherworld._


My heart, my mother; my heart whereby I came into being.

                              HYMN I(1.).

Adored be Râ.

                                 NOTES.

1. A note on the heart.

                           BOOK OF THE DEAD.

                             CHAPTER CXXV.

[Illustration: Papyrus, British Museum, No. 9900.]

                             CHAPTER CXXV.

                                PART I.

Said on arriving at the Hall of Righteousness.`);

	it("keeps the spell number of each Roman chapter heading and numbers its paragraphs", () => {
		const p = parseRenoufBookOfTheDead(raw);
		expect(p.map((x) => x.ref)).toEqual([
			"BD 1.1",
			"BD 1.2",
			"BD 1.3",
			"BD 30.1",
			"BD 30.2",
			"BD 125.1",
		]);
		expect(p[0]?.text).toBe("O Bull of Amenta, It is Thoth, the everlasting King, who is here.");
		expect(p[2]?.text).toBe("I am with Horus on the day of covering Teshtesh.");
		expect(p.some((x) => /NOTES|PLATE|Papyrus|HYMN|PART I|title here/.test(x.text))).toBe(false);
	});

	it("takes the rubric under the heading as the chapter title", () => {
		const p = parseRenoufBookOfTheDead(raw);
		expect(p[0]?.divisionTitle).toBe(
			"The Beginning of the Chapters of Coming forth by Day, of the Words which bring about Resurrection and Glory. Said upon the Day of Burial of N, the Victorious, who entereth after coming forth. Here is N the Victorious. He saith—",
		);
		expect(p[3]?.divisionTitle).toBe(
			"Chapter whereby the heart of a person is not kept back from him in the Netherworld.",
		);
	});
});

describe("parseRenoufBookOfTheDead, the editor's parts", () => {
	const raw = wrap(`                              CHAPTER XVII.

May I prevail over the Long-armed ones in their corners,[69] even as that god.

-----

Footnote 69:

  The four cardinal points.

[Each invocation of this Litany is followed by]

PLATE VII.

[Illustration]

                           BOOK OF THE DEAD.
                             CHAPTER XVII.

                    _a._ Berlin Museum.    No. 1470.

              _See_ NAVILLE, “Book of the Dead,” I, Plate.

[Illustration]

I am Râ at his first appearance.

                  ------------------------------------

                              CHAPTER XX.


The twentieth chapter is entitled _Another Chapter of Crown of Triumph_.

                              CHAPTER LXX.

I seize the east wind by the skin.

ce NOTES TO CHAPTERS LXIX AND LXX.

These last two chapters are always found together.

                              CHAPTER LXXIII.

is identical with Chapter IX.

Footnote 81:

  Cf. note on the Ass of Chapter 40.

                              CHAPTER LXXIV.

I lift my legs.`);

	it("keeps no footnote, plate caption, editor's remark, or chapter that only the editor describes", () => {
		const p = parseRenoufBookOfTheDead(raw);
		expect(p.map((x) => [x.ref, x.text])).toEqual([
			["BD 17.1", "May I prevail over the Long-armed ones in their corners, even as that god."],
			["BD 17.2", "I am Râ at his first appearance."],
			["BD 70.1", "I seize the east wind by the skin."],
			["BD 74.1", "I lift my legs."],
		]);
	});
});

describe("parseBrintonHymns", () => {
	// Project Gutenberg #14993 (Brinton, 1890): the Nahuatl text, its gloss, then the translation.
	const raw = wrap(`I. _Vitzilopochtli icuic._


  1. Vitzilopuchi, yaquetlaya, yyaconay.

_Gloss._

  1. In ivitzilopochtli ayac nouiui.

_Translation._

_The Hymn of Huitzilopochtli._

  1. Huitzilopochtli is first in rank, no one, no one is like unto him:
not vainly do I sing (his praises).

  2. He is a terror to the Mixteca; he alone destroyed the
Picha-Huasteca, he conquered them.


_Notes._

Huitzilopochtli was the well-known war-god of the Azteca.

  1. "In the garb of our ancestors" (_to-citli-quemitl_).


II. _Uitznaoac yautl icuic._

  1. Tlacatla.

_Var._ 6. Vitzanaoac teuhoaqui machiotla. _MS. Med._

_The War Song of the Huitznahuac._

  1. The Lord of the House of Thorns.

_Notes._

  1. A note.

GLOSSARY.`);

	it("takes the English verses of each hymn and none of the Nahuatl, the gloss, or the notes", () => {
		const p = parseBrintonHymns(raw);
		expect(p.map((x) => x.ref)).toEqual(["Aztec Hymn 1.1", "Aztec Hymn 1.2", "Aztec Hymn 2.1"]);
		expect(p[0]?.text).toBe(
			"Huitzilopochtli is first in rank, no one, no one is like unto him: not vainly do I sing (his praises).",
		);
		expect(p.map((x) => x.divisionTitle)).toEqual([
			"The Hymn of Huitzilopochtli",
			"The Hymn of Huitzilopochtli",
			"The War Song of the Huitznahuac",
		]);
	});
});

describe("parseGilesChuangTzu", () => {
	// Project Gutenberg #59709 (Giles, 1889): Giles's notes are indented one space.
	const raw = wrap(`CHAPTER I.

TRANSCENDENTAL BLISS.

 _Argument_:--Space infinite--Time infinite.


In the northern ocean there is a fish, called the Leviathan, many
thousand _li_ in size.

 Distance being relative.

He who goes to Mang-ts'ang,

 A short distance into the country.

taking three meals with him, comes back with his stomach as full as
when he started.

CHAPTER II.

THE IDENTITY OF CONTRARIES.

[This chapter is supplementary to ch. v.]

"Before conditions existed, TAO was. We are conscious of certain delimitations which
are,--

  Right         and   Left
  Emulation     and   Contention

These are called the _Eight Predicables_.

 These have been classified as follows:--

  1. Sovereign     and Subject.

The true Sage does not violate them. [Fancy pitting the happiness.] Neither does he.

When Chuang Tzŭ was about to die, his disciples expressed a wish.

    And had he not high honour?--
    The hillside for his pall;

  _The Burial of Moses_ (Mrs. Alexander).

"We fear," argued the disciples.

       *       *       *       *       *

 As to the genuineness of this concluding chapter.




_INDEX_


  Accidentals, 162`);

	it("numbers the paragraphs from 1 in each chapter, with no note of Giles", () => {
		const p = parseGilesChuangTzu(raw);
		expect(p.map((x) => x.ref)).toEqual([
			"Zhuangzi 1.1",
			"Zhuangzi 1.2",
			"Zhuangzi 2.1",
			"Zhuangzi 2.2",
			"Zhuangzi 2.3",
			"Zhuangzi 2.4",
			"Zhuangzi 2.5",
		]);
		expect(p[0]?.divisionTitle).toBe("Transcendental Bliss");
		expect(
			p.some((x) =>
				/Argument|Distance|short distance|classified|Sovereign|Burial|pall|genuineness|Accidentals|\[/.test(
					x.text,
				),
			),
		).toBe(false);
	});

	it("joins a sentence that a note cut in two, and keeps a list inside the text", () => {
		const p = parseGilesChuangTzu(raw);
		expect(p[0]?.text).toBe(
			"In the northern ocean there is a fish, called the Leviathan, many thousand li in size.",
		);
		expect(p[1]?.text).toBe(
			"He who goes to Mang-ts'ang, taking three meals with him, comes back with his stomach as full as when he started.",
		);
		expect(p[2]?.text).toBe(
			'"Before conditions existed, TAO was. We are conscious of certain delimitations which are,-- Right and Left Emulation and Contention',
		);
		expect(p[4]?.text).toBe("The true Sage does not violate them. Neither does he.");
		expect(p[5]?.text).toBe("When Chuang Tzŭ was about to die, his disciples expressed a wish.");
	});
});

// The parts of a Wikisource page that the four parsers below meet: the header, page numbers,
// footnote marks and the footnote list.
const PAGE =
	'<span><span class="pagenum ws-pagenum" id="16"><span class="pagenum-inner ws-noexport">&#8203;</span></span></span>';
const FN = (n: number) =>
	`<sup id="cite_ref-${n}" class="reference"><a href="#cite_note-${n}"><span class="cite-bracket">&#91;</span>${n}<span class="cite-bracket">&#93;</span></a></sup>`;
const header = (section: string) =>
	`<div class="ws-header wst-header"><div class="wst-header-mainblock"><a href="/wiki/x">PROLOGUE</a><div class="header-section-text">${section}</div></div></div>`;
const notes =
	'<div class="reflist wst-smallrefs"><ol class="references"><li id="cite_note-1">↑ Literally, “that became” (成).</li></ol></div>';

describe("parseChamberlainKojiki", () => {
	const section4 = `${header("Section 4")}<p>${PAGE}</p>
<div class="wst-center tiInherit"><p>[<span class="wst-asc">Sect. IV.—Courtship of the Deities the Male-Who-Invites and the Female-Who-Invites.</span>]</p></div>
<p>Having descended from Heaven onto this island, they saw to the erection${FN(1)} of an heavenly august pillar, they saw to the erection of an hall of eight fathoms${FN(2)}. Tunc quæsivit [Augustus Mas-Qui-Invitat] a ${PAGE}minore sorore Augustâ Feminâ-Qui-Invitat: “Tuum corpus quo in modo factum est?”</p>
<div class="wst-hanging-indent"><p>The five Deities in the above list are separate Heavenly Deities.${FN(3)}</p></div>
<p>Then the Female-Who-Invites said: “How delightful! a lovely youth!”</p>
<p>Then Yata-no-waki-iratsume replied in a Song, saying:</p>
<div class="wst-block-center" style="width:300px;"><p>“Even though the one sedge-stem of Yata be alone, if the Great Lord say it is right, even though it be alone [it is right].”</p></div>
<p>Vol. II.</p>
${notes}`;

	it("numbers the paragraphs of a section, keeps the Latin as printed, and drops the footnotes", () => {
		const p = parseChamberlainKojiki({ "4": section4 });
		expect(p.map((x) => x.ref)).toEqual(["Kojiki 4.1", "Kojiki 4.2", "Kojiki 4.3"]);
		expect(p[0]?.divisionTitle).toBe(
			"Courtship of the Deities the Male-Who-Invites and the Female-Who-Invites",
		);
		expect(p[0]?.text).toBe(
			"Having descended from Heaven onto this island, they saw to the erection of an heavenly august pillar, they saw to the erection of an hall of eight fathoms. Tunc quæsivit [Augustus Mas-Qui-Invitat] a minore sorore Augustâ Feminâ-Qui-Invitat: “Tuum corpus quo in modo factum est?” The five Deities in the above list are separate Heavenly Deities.",
		);
		expect(p[1]?.text).toBe("Then the Female-Who-Invites said: “How delightful! a lovely youth!”");
		expect(p[2]?.text).toBe(
			"Then Yata-no-waki-iratsume replied in a Song, saying: “Even though the one sedge-stem of Yata be alone, if the Great Lord say it is right, even though it be alone [it is right].”",
		);
		expect(p.some((x) => /Literally|\[\d+\]/.test(x.text))).toBe(false);
	});

	it("reads a section heading without brackets", () => {
		const p = parseChamberlainKojiki({
			"180": `<p>${PAGE}</p><p>Sect. CLXXX.—Empress Sui-ko.</p><p>Her Augustness Toyo-mike-kashiki-ya-hime dwelt at the Palace of Woharida.</p><p>The End.</p>`,
		});
		expect(p.map((x) => [x.ref, x.divisionTitle])).toEqual([["Kojiki 180.1", "Empress Sui-ko"]]);
	});
});

describe("parseBrodeurProseEdda", () => {
	const gylfi = `${header("GYLFAGINNING")}<p>${PAGE}</p><p>GYLFAGINNING</p><p>HERE BEGINS THE BEGUILING OF GYLFI</p>
<p><b>I.</b> King Gylfi ruled the land that men now call Sweden. Thus says Bragi, the ancient skald:</p>
<dl><dd>Gefjun drew from Gylfi &#160;&#160; gladly the wave-trove's freehold,</dd>
<dd>Till from the running beasts &#160;&#160; sweat reeked, to Denmark's increase;</dd></dl>
<p><b>II.</b> King Gylfi was a wise man and skilled in magic.${FN(1)}</p>
<p>${PAGE}He saw three high-seats, each above the other.</p>
<p>Footnotes</p>
${notes}`;
	const prologue = `<p>${PAGE}</p><p>PROLOGUE</p><p>IN the beginning God created heaven and earth.</p><p>One thing they wondered and pondered over.</p><p>II</p><p>The world was divided into three parts.</p>`;

	it("numbers the paragraphs of each chapter, with a verse kept in the paragraph before it", () => {
		const p = parseBrodeurProseEdda({ Prologue: prologue, Gylfaginning: gylfi });
		expect(p.map((x) => x.ref)).toEqual([
			"Prologue 1.1",
			"Prologue 1.2",
			"Prologue 2.1",
			"Gylfaginning 1.1",
			"Gylfaginning 2.1",
			"Gylfaginning 2.2",
		]);
		expect(p[3]?.text).toBe(
			"King Gylfi ruled the land that men now call Sweden. Thus says Bragi, the ancient skald: Gefjun drew from Gylfi gladly the wave-trove's freehold, Till from the running beasts sweat reeked, to Denmark's increase;",
		);
		expect(p[4]?.text).toBe("King Gylfi was a wise man and skilled in magic.");
		expect(p[3]?.division).toBe("2");
		expect(p[3]?.subdivision).toBe(1);
	});
});

describe("parseMullerUpanishads", () => {
	const khandogya6 = `<table><tr><td>Khandas (not listed in original)</td><td>First</td></tr></table><p>${PAGE}</p><p>SIXTH PRAPÂTHAKA.</p>
<p>First Khanda.</p><p>1. Harih, Om. There lived once Svetaketu Âruneya (the grandson of Aruna).</p>
<p>2. Having begun his apprenticeship (with a teacher) when he was twelve years of age${FN(1)}, Svetaketu returned to his father.</p>
<p>The father replied: 'My dear, as by one clod of clay all that is made of clay is known.'</p>
<div class="wst-center"><p><span style="font-size:120%;"><span class="smallcaps"><span id="Khanda2" title="Anchor:Khanda2" class="wst-anchor">Elventh Kha<i>nd</i>a</span>${FN(2)}.</span></span></p></div>
<p>1, 2. 'In the beginning,' my dear, "there was that only which is (τὸ ὄν), one only, without a second.</p>${notes}`;
	const kena = `<p>Also known as Kena-upanishad.</p><p>${PAGE}</p><div class="wst-center tiInherit"><p>TALAVAKÂRA-UPANISHAD.</p><p><br />
<span style="font-size:120%;"><span class="smallcaps" style="font-variant:small-caps;">First Kha<i>nd</i>a.</span></span></p></div>
<p>1. The Pupil asks: 'At whose wish does the mind sent forth proceed on its errand?</p><p>2. The Teacher replies: It is the ear of the ear. When freed (from the senses) the wise, on departing from this world, become immortal (Br<i>ah</i>man).</p>`;
	const isa = `<p>Also known as Îsâvâsya-upanishad or Îsâ-upanishad.</p><p>${PAGE}</p><p>VÂGASANEYI-SAMHITÂ-UPANISHAD.</p>
<div><p>1. All this, whatsoever moves on earth, is to be hidden in the Lord (the Self).</p></div><p>2. Though a man may wish to live a hundred years, performing works.</p>`;

	it("cites each Upanishad by its own numbers", () => {
		const p = parseMullerUpanishads({ "Khandogya 6": khandogya6, Kena: kena, Isa: isa });
		expect(p.map((x) => [x.ref, x.division, x.subdivision])).toEqual([
			["Khandogya 6.1", "1", 6],
			["Khandogya 6.2", "1", 6],
			["Kena 1.1", "2", 1],
			["Kena 1.2", "2", 1],
			["Isa 1", "3", 1],
			["Isa 2", "3", 2],
		]);
		expect(p[0]?.text).toBe(
			"1. Harih, Om. There lived once Svetaketu Âruneya (the grandson of Aruna). 2. Having begun his apprenticeship (with a teacher) when he was twelve years of age, Svetaketu returned to his father. The father replied: 'My dear, as by one clod of clay all that is made of clay is known.'",
		);
		expect(p[1]?.text).toBe(
			"1, 2. 'In the beginning,' my dear, \"there was that only which is (τὸ ὄν), one only, without a second.",
		);
		expect(p[2]?.text).toBe(
			"The Pupil asks: 'At whose wish does the mind sent forth proceed on its errand?",
		);
		expect(p[3]?.text).toBe(
			"The Teacher replies: It is the ear of the ear. When freed (from the senses) the wise, on departing from this world, become immortal (Brahman).",
		);
		expect(p.some((x) => /Also known|Khandas|PRAP/.test(x.text))).toBe(false);
	});
});

describe("parseLeggeShuKing", () => {
	const book = `${header("Part I, Book I: The Canon of Yâo")}<p>${PAGE}</p><div class="wst-center"><p>THE SHÛ KING.</p></div>
<div class="wst-center"><p><span class="smallcaps">The Canon of Yâo.</span></p></div>
<div class="wst-size-block wst-smaller wst-smaller-block"><div class="wst-hanging-indent"><p>Shû King, the name of the whole work, has been sufficiently explained in the Introduction.</p></div><p>Yâo is the subject of the Book.</p></div>
<p>${PAGE}<span id="ch1" title="Anchor:ch1" class="wst-anchor">1.</span> Examining into antiquity, (we find that) the Tî Yâo${FN(1)} was styled Fang-hsün.</p>
<p>He made the able and virtuous distinguished.* He (also) regulated and polished the people.</p>
<p>3. The Tî said, 'Who will search out (for me) a man according to the times?'</p>${notes}`;
	const section = (n: number, paras: number) =>
		`${header(`Part IV, Book V: The Thâi Kiâ, Section ${n}`)}<p>${PAGE}</p><p>Section ${n}.</p>${Array.from(
			{ length: paras },
			(_, i) => `<p>Words of section ${n}, paragraph ${i + 1}.</p>`,
		).join("")}`;

	it("leaves out Legge's introduction and notes, and numbers the paragraphs of a book", () => {
		const p = parseLeggeShuKing({ "1.1": book });
		expect(p.map((x) => [x.ref, x.division, x.subdivision, x.divisionTitle])).toEqual([
			["Shu 1.1.1", "1", 1, "The Canon of Yâo"],
			["Shu 1.1.2", "1", 1, "The Canon of Yâo"],
			["Shu 1.1.3", "1", 1, "The Canon of Yâo"],
		]);
		expect(p.map((x) => x.text)).toEqual([
			"Examining into antiquity, (we find that) the Tî Yâo was styled Fang-hsün.",
			"He made the able and virtuous distinguished. He (also) regulated and polished the people.",
			"The Tî said, 'Who will search out (for me) a man according to the times?'",
		]);
		expect(
			p.some((x) => /whole work|subject of the Book|Literally|SHÛ|Canon of Yâo\./.test(x.text)),
		).toBe(false);
	});

	it("numbers the paragraphs of a book with sections on through its sections, and skips its index page", () => {
		const index = `${header("Part IV, Book V: The Thâi Kiâ")}<p>${PAGE}</p><p>Sections (containing the body text)</p>`;
		const p = parseLeggeShuKing({ "4.5": index, "4.5.1": section(1, 2), "4.5.2": section(2, 1) });
		expect(p.map((x) => [x.ref, x.divisionTitle])).toEqual([
			["Shu 4.5.1", "The Thâi Kiâ, Section 1"],
			["Shu 4.5.2", "The Thâi Kiâ, Section 1"],
			["Shu 4.5.3", "The Thâi Kiâ, Section 2"],
		]);
		expect(p[2]?.text).toBe("Words of section 2, paragraph 1.");
	});
});
