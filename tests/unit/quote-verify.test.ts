import { describe, expect, it } from "bun:test";
import { candidateQuery, scoreQuote, tokenize } from "../../src/lib/quote-verify.ts";

// The text of 2:5.1.
const P = `"God is love"; therefore his only personal attitude towards the affairs of the universe is always a reaction of divine affection. The Father loves us sufficiently to bestow his life upon us. "He makes his sun to rise on the evil and on the good and sends rain on the just and on the unjust."`;

describe("scoreQuote", () => {
	it("finds an exact quote, ignoring case and punctuation", () => {
		const score = scoreQuote("the father loves us sufficiently to bestow his life upon us", P);
		expect(score.verdict).toBe("exact");
		expect(score.similarity).toBe(1);
		expect(score.matchedText).toBe("The Father loves us sufficiently to bestow his life upon us");
		expect(score.differences).toEqual([]);
	});

	it("calls a quote with one changed word close, and names the change", () => {
		const score = scoreQuote("The Father loves us enough to bestow his life upon us.", P);
		expect(score.verdict).toBe("close");
		expect(score.differences).toEqual([{ quote: "enough", text: "sufficiently" }]);
	});

	it("names a missing word and an added word", () => {
		expect(scoreQuote("The Father loves us to bestow his life upon us", P).differences).toEqual([
			{ quote: "", text: "sufficiently" },
		]);
		expect(
			scoreQuote("The Father truly loves us sufficiently to bestow his life upon us", P)
				.differences,
		).toEqual([{ quote: "truly", text: "" }]);
	});

	it("rejects a passage that is not in the paragraph", () => {
		const score = scoreQuote("Intelligent courage is the supreme valor of a truly moral being", P);
		expect(score.verdict).toBe("not_found");
		expect(score.similarity).toBeLessThan(0.5);
	});

	it("does not call scattered common words a match", () => {
		expect(scoreQuote("the of the and on the his us", P).verdict).not.toBe("exact");
		expect(scoreQuote("on the evil the good the just and the unjust life", P).verdict).toBe(
			"not_found",
		);
	});

	it("treats curly and straight apostrophes the same", () => {
		const text = "It is the Father's will that all should live.";
		expect(scoreQuote("it is the father’s will that all should live", text).verdict).toBe("exact");
	});
});

describe("tokenize and candidateQuery", () => {
	it("keeps positions, so the original text can be cut back out", () => {
		const [first] = tokenize(`"God is love"`);
		expect(first).toEqual({ word: "god", surface: "God", start: 1, end: 4 });
	});

	it("joins the distinct words with OR", () => {
		expect(candidateQuery("God is love, God is good")).toBe("god or is or love or good");
	});
});
