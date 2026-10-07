import { describe, expect, test } from "bun:test";
import { MAX_RANGE, parseScriptureRef } from "../../src/lib/scripture-ref.ts";

describe("parseScriptureRef", () => {
	test("reads a division and a number, with either separator", () => {
		expect(parseScriptureRef("2.47", "BG")).toEqual({
			kind: "unit",
			division: 2,
			start: 47,
			end: 47,
		});
		expect(parseScriptureRef("BG 2:47", "BG")).toEqual({
			kind: "unit",
			division: 2,
			start: 47,
			end: 47,
		});
		expect(parseScriptureRef("bg  2.47-49", "BG")).toEqual({
			kind: "unit",
			division: 2,
			start: 47,
			end: 49,
		});
	});

	test("reads a bare number as a division, and a bare range as numbers", () => {
		expect(parseScriptureRef("25", "TTC")).toEqual({ kind: "division", division: 25 });
		expect(parseScriptureRef("Dhp 183", "Dhp")).toEqual({ kind: "division", division: 183 });
		expect(parseScriptureRef("58-59", "Dhp")).toEqual({ kind: "number", start: 58, end: 59 });
	});

	test("rejects text that is not a reference", () => {
		for (const bad of ["", "abc", "2.", "0", "2.0", "2.47-40", "1.1.1", "Analects 1,1", "12345"]) {
			expect(parseScriptureRef(bad, "Analects")).toBeNull();
		}
	});

	test("rejects a range over the maximum", () => {
		expect(parseScriptureRef(`1-${MAX_RANGE}`, "Dhp")).not.toBeNull();
		expect(parseScriptureRef(`1-${MAX_RANGE + 1}`, "Dhp")).toBeNull();
	});
});
