import { describe, expect, it } from "bun:test";
import { type Item, type Pause, place, placeSentences, sentences } from "./place";

// A file made of items with a pause after each: [speech, pause, speech, pause, ...].
function file(lengths: number[], gap = 0.8, inner: number[][] = []) {
	const pauses: Pause[] = [];
	const starts: number[] = [];
	let t = 0;
	lengths.forEach((len, i) => {
		starts.push(t);
		for (const at of inner[i] ?? []) pauses.push({ start: t + at, end: t + at + 0.4 });
		t += len;
		if (i < lengths.length - 1) {
			pauses.push({ start: t, end: t + gap });
			t += gap;
		}
	});
	return { pauses, starts, total: t };
}

const para = (key: string, expect: number): Item => ({ kind: "para", key, expect });

describe("placing the items of a paper in its full file", () => {
	it("places each item at the end of the pause before it", () => {
		const { pauses, starts, total } = file([2, 30, 12, 25]);
		const items: Item[] = [
			{ kind: "title", key: "title", expect: 2, text: "The Universal Father" },
			para("1:0.1", 30.7),
			para("1:0.2", 12.7),
			para("1:0.3", 25.7),
		];
		const placed = place(items, pauses, total);
		expect(placed?.starts.map((s) => s.at)).toEqual(starts.map((s) => Math.round(s * 100) / 100));
	});

	it("takes the fit of the whole paper, not the nearest pause to one paragraph", () => {
		// Paragraph 1 has a sentence pause 1 second before its end; the global fit still ends it at its real end.
		const { pauses, starts, total } = file([2, 30, 12, 25], 0.8, [[], [29], [], []]);
		const items: Item[] = [
			{ kind: "title", key: "title", expect: 2, text: "Paper" },
			para("a", 30.6),
			para("b", 12.6),
			para("c", 25.6),
		];
		const placed = place(items, pauses, total);
		expect(placed?.starts[2].at).toBeCloseTo(starts[2], 2);
	});

	it("gives no placement when the file cannot hold the items", () => {
		const { pauses, total } = file([2, 30, 12]);
		const items: Item[] = [
			{ kind: "title", key: "title", expect: 2, text: "Paper" },
			para("a", 30),
			para("b", 12),
			para("c", 40),
		];
		expect(place(items, pauses, total)).toBeNull();
	});

	it("reports the constant and the worst error of a paragraph", () => {
		const { pauses, total } = file([2, 30, 12, 25]);
		const items: Item[] = [
			{ kind: "title", key: "title", expect: 2, text: "Paper" },
			para("a", 30.8),
			para("b", 12.8),
			para("c", 25.8),
		];
		const placed = place(items, pauses, total);
		expect(placed?.offset).toBeCloseTo(-0.8, 1);
		expect(placed?.worst).toBeLessThan(0.05);
	});
});

describe("placing the sentences of a paragraph", () => {
	it("starts each sentence after the pause that fits its share of the characters", () => {
		const text = "A short one. A sentence that is about three times longer than the first. End.";
		const parts = sentences(text);
		// 30 seconds in all, with pauses inside at the two sentence ends, and one breath pause in the middle.
		const pauses: Pause[] = [
			{ start: 4.6, end: 5.0 },
			{ start: 14, end: 14.3 },
			{ start: 26, end: 26.4 },
		];
		const at = placeSentences(parts, 0, 30, pauses);
		expect(at).toEqual([0, 5, 26.4]);
	});

	it("gives nothing when the paragraph has fewer pauses than sentence ends", () => {
		expect(placeSentences(["One.", "Two.", "Three."], 0, 10, [{ start: 3, end: 3.4 }])).toBeNull();
	});
});

describe("the sentences of a paragraph (the rule of the Hub)", () => {
	it("splits as the Hub does", () => {
		expect(sentences("1. The Gospel by Mark. John Mark wrote it in A.D. 68. It is short.")).toEqual(
			["1. The Gospel by Mark.", "John Mark wrote it in A.D. 68.", "It is short."],
		);
		expect(sentences("  ")).toEqual([]);
	});
});
