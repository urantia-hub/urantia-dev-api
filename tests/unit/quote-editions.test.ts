import { describe, expect, it } from "bun:test";
import { olderWordingRefs, scoreInEditions } from "../../src/lib/quote-editions.ts";

// The stored (srt-2024) words of 98:3.8 around its 2024 change.
const P983 =
	"The cult had a roster of more than two-score self-elevated human deities, all of whom were worshiped.";

describe("scoreInEditions", () => {
	it("scores a quote of the current text in the default edition", () => {
		const r = scoreInEditions(
			"a roster of more than two-score self-elevated human deities",
			"98:3.8",
			P983,
		);
		expect(r.score.verdict).toBe("exact");
		expect(r.edition.id).toBe("srt-2024");
		expect(r.editions.map((e) => e.id)).toEqual(["srt-2024"]);
	});

	it("finds the 1955 wording exact in an older edition, not close", () => {
		const r = scoreInEditions(
			"a roster of more than twoscore self-elevated human deities",
			"98:3.8",
			P983,
		);
		expect(r.score.verdict).toBe("exact");
		// The newest edition that has "twoscore" is srt-2021; it was there from 1955.
		expect(r.edition.id).toBe("srt-2021");
		expect(r.editions.map((e) => e.id)).toEqual([
			"1955",
			"srt-2009",
			"srt-2015",
			"srt-2018",
			"srt-2021",
		]);
	});

	it("keeps the default edition on a tie, such as a quote that skips the changed words", () => {
		const r = scoreInEditions(
			"self-elevated human deities, all of whom were worshiped",
			"98:3.8",
			P983,
		);
		expect(r.edition.id).toBe("srt-2024");
	});

	it("gives a paragraph with no change its stored text", () => {
		const r = scoreInEditions(
			"the father loves us sufficiently",
			"2:5.1",
			"The Father loves us sufficiently.",
		);
		expect(r.edition.id).toBe("srt-2024");
		expect(r.score.verdict).toBe("exact");
		// The wording is in every edition.
		expect(r.editions).toHaveLength(6);
	});

	it("scores the stored text when it does not hold the change", () => {
		const r = scoreInEditions(
			"some other words of the paragraph",
			"98:3.8",
			"some other words of the paragraph",
		);
		expect(r.edition.id).toBe("srt-2024");
	});
});

describe("olderWordingRefs", () => {
	it("names a paragraph whose old words the quote uses", () => {
		expect(olderWordingRefs("more than twoscore self-elevated human deities")).toContain("98:3.8");
	});

	it("does not name it for the current words", () => {
		expect(olderWordingRefs("more than two-score self-elevated human deities")).not.toContain(
			"98:3.8",
		);
	});

	it("needs a neighbor word for a removed word", () => {
		// 0:1.24 removed "other" in "in all other manifestations".
		expect(olderWordingRefs("the other people came to the city")).not.toContain("0:1.24");
		expect(olderWordingRefs("exists in all other manifestations of perfection")).toContain(
			"0:1.24",
		);
	});

	it("names nothing for a change that only added words", () => {
		// 60:3.8 added "the": "85,000,000 years ago Bering Strait" in 1955.
		expect(olderWordingRefs("85,000,000 years ago Bering Strait land bridge")).not.toContain(
			"60:3.8",
		);
	});
});
