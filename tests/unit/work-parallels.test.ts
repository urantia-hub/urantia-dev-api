import { describe, expect, it } from "bun:test";
import { topOthers } from "../../scripts/scriptures/work-top.ts";

const v = (...xs: number[]) => Float32Array.from(xs);

describe("the nearest chunks of the other works", () => {
	const candidates = [
		{ id: "own", corpus: "dhammapada", v: v(1, 0, 0) },
		{ id: "far", corpus: "koran", v: v(0, 0, 1) },
		{ id: "near", corpus: "koran", v: v(0.9, 0.1, 0) },
		{ id: "mid", corpus: "bible", v: v(0.5, 0.5, 0) },
	];

	it("skips the own work and gives the nearest first", () => {
		expect(topOthers(v(1, 0, 0), candidates, "dhammapada", 2)).toEqual([
			{ id: "near", similarity: expect.closeTo(0.9, 5) },
			{ id: "mid", similarity: expect.closeTo(0.5, 5) },
		]);
	});

	it("gives at most k, and all of them when there are fewer", () => {
		expect(topOthers(v(1, 0, 0), candidates, "dhammapada", 1).map((t) => t.id)).toEqual(["near"]);
		expect(topOthers(v(1, 0, 0), candidates, "dhammapada", 10).map((t) => t.id)).toEqual([
			"near",
			"mid",
			"far",
		]);
	});
});
