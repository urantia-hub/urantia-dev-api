import { describe, expect, test } from "bun:test";
import {
	chunkPassages,
	MAX_WORDS,
	rangeLabel,
	refNumbers,
} from "../../scripts/scriptures/chunk.ts";
import type { Passage } from "../../scripts/scriptures/parsers.ts";

const p = (ref: string, sort: number, division: string, words: number): Passage => ({
	ref,
	sort,
	division,
	divisionTitle: null,
	text: Array.from({ length: words }, () => "word").join(" "),
});

describe("refNumbers", () => {
	test("reads a single number, a two-level ref, and a combined passage", () => {
		expect(refNumbers("Dhp 5")).toEqual({ start: 5, end: 5 });
		expect(refNumbers("BG 2.47")).toEqual({ start: 47, end: 47 });
		expect(refNumbers("Dhp 58-59")).toEqual({ start: 58, end: 59 });
	});
});

describe("rangeLabel", () => {
	test("joins the first and last refs", () => {
		expect(rangeLabel("BG 2.47", "BG 2.47")).toBe("BG 2.47");
		expect(rangeLabel("BG 2.47", "BG 2.49")).toBe("BG 2.47-49");
		expect(rangeLabel("Dhp 57", "Dhp 58-59")).toBe("Dhp 57-59");
	});
});

describe("chunkPassages", () => {
	test("groups short passages until the minimum size", () => {
		const chunks = chunkPassages([
			p("BG 1.1", 1001, "1", 25),
			p("BG 1.2", 1002, "1", 25),
			p("BG 1.3", 1003, "1", 25),
			p("BG 1.4", 1004, "1", 25),
		]);
		expect(chunks.map((c) => c.label)).toEqual(["BG 1.1-3", "BG 1.4"]);
		expect(chunks[0]?.sortStart).toBe(1001);
		expect(chunks[0]?.sortEnd).toBe(1003);
	});

	test("never crosses a division", () => {
		const chunks = chunkPassages([p("BG 1.47", 1047, "1", 10), p("BG 2.1", 2001, "2", 10)]);
		expect(chunks.map((c) => c.refs)).toEqual([["BG 1.47"], ["BG 2.1"]]);
	});

	test("does not grow past the maximum, and keeps a long passage alone", () => {
		const chunks = chunkPassages([
			p("Analects 1.1", 1001, "1", 50),
			p("Analects 1.2", 1002, "1", MAX_WORDS),
			p("Analects 1.3", 1003, "1", 20),
		]);
		expect(chunks.map((c) => c.refs)).toEqual([
			["Analects 1.1"],
			["Analects 1.2"],
			["Analects 1.3"],
		]);
	});

	test("never crosses a titled part, such as one life in Diogenes Laertius", () => {
		const a = { ...p("DL 6.19", 6019, "6", 10), divisionTitle: "Antisthenes" };
		const b = { ...p("DL 6.20", 6020, "6", 10), divisionTitle: "Diogenes" };
		expect(chunkPassages([a, b]).map((c) => c.refs)).toEqual([["DL 6.19"], ["DL 6.20"]]);
	});

	test("makes one chunk per division when asked", () => {
		const chunks = chunkPassages(
			[
				p("TTC 1.1", 101, "1", 70),
				p("TTC 1.2", 102, "1", 70),
				p("TTC 1.3", 103, "1", 70),
				p("TTC 2.1", 201, "2", 5),
			],
			true,
		);
		expect(chunks.map((c) => c.label)).toEqual(["TTC 1", "TTC 2"]);
	});

	test("keeps every passage exactly once, in order", () => {
		const input = Array.from({ length: 40 }, (_, i) =>
			p(`Dhp ${i + 1}`, i + 1, String(1 + Math.floor(i / 9)), 7 + (i % 30)),
		);
		expect(chunkPassages(input).flatMap((c) => c.refs)).toEqual(input.map((x) => x.ref));
	});
});
