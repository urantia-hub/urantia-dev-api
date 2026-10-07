import { describe, expect, test } from "bun:test";
import {
	adjustedPercentiles,
	mutualPairs,
	scoreParagraph,
} from "../../scripts/scriptures/scores-math.ts";

const f = (xs: number[]) => Float64Array.from(xs);

describe("adjustedPercentiles", () => {
	test("ranks what length does not explain", () => {
		// Similarity rises with length, except paragraph 2, which is high for its length.
		const lengths = [100, 200, 400, 800];
		const out = adjustedPercentiles({ t: f([0.3, 0.35, 0.6, 0.45]) }, lengths);
		const p = out.t as Float64Array;
		expect(p[2]).toBeGreaterThan(p[3] as number);
		expect(Math.max(...p)).toBe(p[2]);
	});

	test("skips missing scores and gives ties the same rank", () => {
		const out = adjustedPercentiles({ t: f([0.5, Number.NaN, 0.5]) }, [100, 100, 100]);
		const p = out.t as Float64Array;
		expect(Number.isNaN(p[1])).toBe(true);
		expect(p[0]).toBe(p[2]);
	});
});

describe("scoreParagraph", () => {
	const texts = ["a", "b", "c"];
	test("counts close texts, averages, and measures distance", () => {
		const adj = { a: f([0.95]), b: f([0.92]), c: f([0.4]) };
		const s = scoreParagraph(0, texts, adj, adj);
		expect(s.textsClose).toBe(2);
		expect(s.consensus).toBeCloseTo((0.95 + 0.92 + 0.4) / 3);
		expect(s.distance).toBeCloseTo(0.05);
		expect(s.leanCorpus).toBe("a");
		expect(s.profile).toEqual({ a: 0.95, b: 0.92, c: 0.4 });
	});

	test("keeps a lean only above the floor and when both models agree", () => {
		const large = { a: f([0.95]), b: f([0.5]), c: f([0.4]) };
		expect(
			scoreParagraph(0, texts, large, { a: f([0.2]), b: f([0.9]), c: f([0.1]) }).leanCorpus,
		).toBeNull();
		const low = { a: f([0.8]), b: f([0.5]), c: f([0.4]) };
		expect(scoreParagraph(0, texts, low, low).leanCorpus).toBeNull();
	});
});

describe("mutualPairs", () => {
	test("keeps a pair only when both models agree in both directions", () => {
		const largeBest = new Map([
			["p1|t", "k1"],
			["p2|t", "k2"],
			["p3|t", "k3"],
		]);
		const largeRev = new Map([
			["k1", "p1"],
			["k2", "p2"],
			["k3", "p9"],
		]);
		const smallBest = new Map([
			["p1|t", "k1"],
			["p2|t", "k9"],
			["p3|t", "k3"],
		]);
		const smallRev = new Map([
			["k1", "p1"],
			["k3", "p3"],
		]);
		expect(
			mutualPairs(["p1", "p2", "p3"], ["t"], largeBest, largeRev, smallBest, smallRev),
		).toEqual([{ paragraphId: "p1", corpusId: "t", chunkId: "k1" }]);
	});
});
