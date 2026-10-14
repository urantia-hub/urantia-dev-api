import { describe, expect, it } from "bun:test";
import type { Pause } from "./place";
import { heardMatches, repair } from "./verify";

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

// A fake voice: at each true start it says the words of that item, elsewhere other words.
function voice(truth: number[], texts: string[]) {
	const asked: number[] = [];
	const hear = async (ats: number[]) =>
		ats.map((t) => {
			asked.push(t);
			const i = truth.findIndex((s) => Math.abs(s - t) < 0.01);
			return i === -1 ? "something else entirely" : (texts[i] ?? "");
		});
	return { hear, asked };
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
