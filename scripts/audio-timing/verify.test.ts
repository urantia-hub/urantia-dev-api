import { describe, expect, it } from "bun:test";
import type { Pause } from "./place";
import { earTimes, endCost, heardMatches, matchCost, repair } from "./verify";

describe("the words heard at a start against the text", () => {
	it("takes a near spelling of a name", () => {
		expect(heardMatches("macaventa milchizadec", "Machiventa Melchizedek")).toBe(true);
		expect(heardMatches("on euranchia they re", "On Urantia there function")).toBe(true);
		expect(heardMatches("the no dite race", "The Nodite Race")).toBe(true);
	});

	it("takes the paper number before a title and a spoken list number", () => {
		expect(heardMatches("paper 44 the celestial", "The Celestial Artisans")).toBe(true);
		expect(heardMatches("number one celestial musicians", "1. Celestial Musicians.")).toBe(true);
		expect(heardMatches("in about 14 years", "When about fourteen years of age")).toBe(true);
		expect(heardMatches("These 31 papers depicting", "These thirty-one papers depicting")).toBe(
			true,
		);
		expect(heardMatches("Number 7. The Courtin Space Level.", "7. The Outer Space Level.")).toBe(
			true,
		);
		expect(
			heardMatches("Number 1, Hovona Natives. Number 2, Gravity Messengers.", "1. Havona Natives."),
		).toBe(true);
	});

	it("takes a section title without its Roman number, which the voice does not read", () => {
		expect(heardMatches("God. Evolving mortal creatures", "II. God")).toBe(true);
		expect(heardMatches("The Trinities. The Trinities", "XII. The Trinities")).toBe(true);
	});

	it("takes a start where the model dropped the first word or two", () => {
		expect(
			heardMatches(
				"by a divine councillor of U Versa",
				"[Presented by a Divine Counselor of Uversa.]",
			),
		).toBe(true);
		expect(
			heardMatches(
				"Spia universal sensor from U Versa.",
				"[Presented by a Universal Censor from Uversa.]",
			),
		).toBe(true);
	});

	it("takes a short title where the model dropped its first word, when the rest is exact", () => {
		expect(heardMatches("density. The mass of your sun is slight.", "Solar Density")).toBe(true);
		expect(heardMatches("density. The mass of your sun is slight.", "Solar Mass")).toBe(false);
	});

	it("refuses the words of another paragraph", () => {
		expect(heardMatches("at the present time", "The Evangels of Light")).toBe(false);
		expect(heardMatches("1 000 years of", "All celestial artisans are")).toBe(false);
		expect(heardMatches("number one celestial musicians", "2. Heavenly Reproducers.")).toBe(false);
		expect(heardMatches("Number 4, Thought Recorders. Number 5", "5. Energy Manipulators.")).toBe(
			false,
		);
	});

	it("takes any sound for a text with no words, and no sound for a text with words", () => {
		expect(heardMatches("", "* * *")).toBe(true);
		expect(heardMatches("", "The Nodite Race")).toBe(false);
	});
});

// A fake voice: at each true start it says the words of that item, and before it the end of the item
// before. Elsewhere it says other words.
function voice(truth: number[], texts: string[]) {
	const asked: number[] = [];
	const hear = async (ats: number[], before = false) =>
		ats.map((t) => {
			asked.push(t);
			const i = truth.findIndex((s) => Math.abs(s - t) < 0.01);
			if (i === -1) return "something else entirely";
			return (before ? texts[i - 1] : texts[i]) ?? "";
		});
	return { hear, asked };
}

// A fake voice from what it says after each time, and before it.
function sayer(after: Record<number, string>, before: Record<number, string>) {
	return async (ats: number[], back = false) =>
		ats.map((t) => (back ? before[t] : after[t]) ?? "something else entirely");
}

const ends = (ats: number[]): Pause[] => ats.map((t) => ({ start: t - 0.6, end: t }));

describe("the repair of a start the voice does not confirm", () => {
	const texts = ["Alpha title", "Bravo begins", "Charlie comes", "Delta does", "Echo ends"];

	it("keeps the starts that the voice confirms", async () => {
		const truth = [0, 10, 20, 30, 40];
		const { hear } = voice(truth, texts);
		const fixed = await repair(texts, truth, ends([10, 15, 20, 30, 40]), hear);
		expect(fixed).toEqual({ at: truth, missed: [], moved: 0 });
	});

	it("moves a start to the nearby pause where its words begin", async () => {
		const truth = [0, 10, 20, 30, 40];
		const { hear } = voice(truth, texts);
		const fixed = await repair(texts, [0, 10, 15, 30, 40], ends([10, 15, 20, 30, 40]), hear);
		expect(fixed).toEqual({ at: truth, missed: [], moved: 1 });
	});

	it("mends a run of starts that are each one item early", async () => {
		const truth = [0, 10, 14, 18, 30];
		const { hear } = voice(truth, texts);
		const fixed = await repair(texts, [0, 10, 12, 14, 30], ends([10, 12, 14, 18, 30]), hear);
		expect(fixed).toEqual({ at: truth, missed: [], moved: 2 });
	});

	it("names the item whose words are not near", async () => {
		const truth = [0, 10, 99, 30, 40];
		const { hear } = voice(truth, texts);
		const fixed = await repair(texts, [0, 10, 20, 30, 40], ends([10, 20, 30, 40]), hear);
		expect(fixed.missed).toEqual([2]);
	});
});

describe("the cost of a match: the words dropped to make it", () => {
	it("is 0 when the start is exact, and counts the words dropped on either side", () => {
		const text = "[Presented by a Divine Counselor of Uversa.]";
		expect(matchCost("Presented by a divine counselor of Uversa", text)).toBe(0);
		expect(matchCost("by a divine counselor of U Versa", text)).toBe(1);
		// A start one word later can also match: its cost is higher, so the start before it wins.
		expect(matchCost("a divine counselor of U Versa", text)).toBeGreaterThan(1);
		expect(
			matchCost(
				"of destiny. When the mortal intellect attempts",
				"When the mortal intellect attempts to grasp",
			),
		).toBe(2);
		expect(matchCost("the formation of all matter", "The Evangels of Light")).toBeNull();
	});

	it("leaves out a number said in words, with its 'and' and 'million'", () => {
		expect(
			matchCost(
				"Two hundred and eighty million years ago, the continents had largely emerged.",
				"280,000,000 years ago the continents had largely emerged from the second",
			),
		).toBe(0);
		expect(
			matchCost(
				"Four billion, 500 million years ago, the enormous Angona system",
				"4,500,000,000 years ago the enormous Angona system began its approach",
			),
		).toBe(0);
	});

	it("is 0 for the list number alone at the start of a list item, and null for another number", () => {
		expect(matchCost("Number 6.", "6. The Recorders. These personalities are")).toBe(0);
		expect(matchCost("Number six.", "6. The Recorders.")).toBe(0);
		expect(matchCost("Number 5.", "6. The Recorders.")).toBeNull();
	});
});

describe("the refine of a start that matched only with dropped words", () => {
	const texts = [
		"Alpha title words here",
		"Presented by a Divine Counselor of Uversa",
		"When the mortal intellect attempts to grasp",
	];

	it("moves a late start back to the pause before the dropped words", async () => {
		// The voice says "Presented by" at 10 and pauses; the start sits at 11.2, after "by".
		const hear = sayer(
			{ 0: texts[0], 10: texts[1], 11.2: "a Divine Counselor of Uversa", 20: texts[2] },
			{ 10: texts[0], 11.2: "words here. Presented by", 20: texts[1] },
		);
		const pauses: Pause[] = [10, 11.2, 20].map((t) => ({ start: t - 0.3, end: t }));
		const fixed = await repair(texts, [0, 11.2, 20], pauses, hear);
		expect(fixed.at).toEqual([0, 10, 20]);
		expect(fixed.missed).toEqual([]);
	});

	it("moves an early start on to the pause after the words of the item before", async () => {
		const hear = sayer(
			{ 0: texts[0], 10: texts[1], 18.4: `of Uversa. ${texts[2]}`, 20: texts[2] },
			{ 10: texts[0], 18.4: "a Divine Counselor", 20: texts[1] },
		);
		const pauses: Pause[] = [10, 18.4, 20].map((t) => ({ start: t - 0.3, end: t }));
		const fixed = await repair(texts, [0, 10, 18.4], pauses, hear);
		expect(fixed.at).toEqual([0, 10, 20]);
	});
});

describe("the words heard just before a start against the end of the item before", () => {
	const text = "It is of so little practical significance to the mortal mind.";

	it("is 0 when the item before ends there, and takes a word of the next item heard at the end", () => {
		expect(endCost("of little practical significance to the mortal mind.", text)).toBe(0);
		expect(endCost("significance to the mortal mind. Your", text)).not.toBeNull();
		expect(endCost("Paper 15. The Seven Superuniverses", "The Seven Superuniverses")).toBe(0);
	});

	it("refuses an end where the last words of the item before are still to come", () => {
		expect(endCost("of so little practical significance to the", text)).toBeNull();
		expect(
			endCost(
				"And on, into the far away and inconceivable stretches of absolutes.",
				"and on into the faraway and inconceivable stretches of absolute infinity.",
			),
		).toBeNull();
	});

	it("takes a misheard name at the end", () => {
		expect(
			endCost("Period, the Brachia Pot Age.", "The Coral Period—The Brachiopod Age"),
		).not.toBeNull();
		expect(endCost("Super-universes 7, Major Sector 70.", "Major sectors 70")).not.toBeNull();
		expect(
			endCost("I am as tri-union as sevenfold.", "The I AM as Triune and as Sevenfold"),
		).not.toBeNull();
	});

	it("leaves out the numbers, as at a start", () => {
		expect(
			endCost(
				"by singing, all together, the 118th Psalm.",
				"by singing, all together, the one hundred and eighteenth Psalm.",
			),
		).toBe(0);
	});
});

describe("the end check at each start", () => {
	const texts = [
		"Alpha title words",
		"Bravo begins and ends with the mortal mind.",
		"Your planet is a member",
	];

	it("moves a start that sits in the last words of the item before, though its own words match", async () => {
		// The model drops "the mortal mind." at the start of its window, so the start alone looks right.
		const hear = sayer(
			{ 0: texts[0], 10: texts[1], 18.5: texts[2], 20: texts[2] },
			{ 10: texts[0], 18.5: "Bravo begins and ends with", 20: texts[1] },
		);
		const pauses: Pause[] = [10, 18.5, 20].map((t) => ({ start: t - 0.3, end: t }));
		const fixed = await repair(texts, [0, 10, 18.5], pauses, hear);
		expect(fixed).toEqual({ at: [0, 10, 20], missed: [], moved: 1 });
	});

	it("keeps a start whose words match when no pause near also has the end before it", async () => {
		// The model can drop or mishear the last words before a start: that alone never fails a paper.
		const hear = sayer(
			{ 0: texts[0], 10: texts[1], 18.5: texts[2] },
			{ 10: texts[0], 18.5: "Bravo begins and ends with" },
		);
		const pauses: Pause[] = [10, 18.5].map((t) => ({ start: t - 0.3, end: t }));
		const fixed = await repair(texts, [0, 10, 18.5], pauses, hear);
		expect(fixed).toEqual({ at: [0, 10, 18.5], missed: [], moved: 0 });
	});

	it("prefers, for a start that moves, the pause that also has the end before it", async () => {
		const hear = sayer(
			{ 0: texts[0], 10: texts[1], 18.5: texts[2], 20: texts[2] },
			{ 10: texts[0], 18.5: "Bravo begins and ends with", 20: texts[1] },
		);
		const pauses: Pause[] = [10, 15, 18.5, 20].map((t) => ({ start: t - 0.3, end: t }));
		const fixed = await repair(texts, [0, 10, 15], pauses, hear);
		expect(fixed).toEqual({ at: [0, 10, 20], missed: [], moved: 1 });
	});
});

describe("a start that a person checked by ear", () => {
	const keys = ["title", "section:1", "1:1.1", "1:1.2"];

	it("gives the index of each item with its time", () => {
		expect(earTimes(keys, { "1:1.1": 9.4, "section:1": 6.2 })).toEqual(
			new Map([
				[1, 6.2],
				[2, 9.4],
			]),
		);
	});

	it("refuses a key that is not in the paper, and times out of order", () => {
		expect(() => earTimes(keys, { "1:9.9": 3 })).toThrow("1:9.9");
		expect(() => earTimes(keys, { "section:1": 9, "1:1.1": 8 })).toThrow("1:1.1");
	});

	it("keeps the time heard by ear in the repair, and no other start moves past it", async () => {
		const texts = ["Alpha title", "Bravo begins", "Charlie comes", "Delta does", "Echo ends"];
		// The voice says item 1 at 10. At 24 it says the same words again, nearer to the wrong start at 22.
		const hear = sayer(
			{ 0: texts[0], 10: texts[1], 24: texts[1], 30: texts[3], 40: texts[4] },
			{ 10: texts[0], 24: texts[1], 30: texts[2], 40: texts[3] },
		);
		const fixed = await repair(
			texts,
			[0, 22, 26, 30, 40],
			ends([10, 20, 24, 30, 40]),
			hear,
			20,
			new Map([[2, 20]]),
		);
		expect(fixed).toEqual({ at: [0, 10, 20, 30, 40], missed: [], moved: 1 });
	});
});
