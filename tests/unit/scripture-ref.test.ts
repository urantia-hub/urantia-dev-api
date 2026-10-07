import { describe, expect, test } from "bun:test";
import { MAX_RANGE, parseScriptureRef } from "../../src/lib/scripture-ref.ts";

describe("parseScriptureRef", () => {
	test("reads a two-level ref, with either separator and with or without the prefix", () => {
		expect(parseScriptureRef("2.47", "BG", 2)).toEqual({ path: [2, 47], end: 47, full: true });
		expect(parseScriptureRef("BG 2:47", "BG", 2)).toEqual({ path: [2, 47], end: 47, full: true });
		expect(parseScriptureRef("bg  2.47-49", "BG", 2)).toEqual({
			path: [2, 47],
			end: 49,
			full: true,
		});
	});

	test("reads a shorter ref as a whole part", () => {
		expect(parseScriptureRef("25", "TTC", 2)).toEqual({ path: [25], end: 25, full: false });
		expect(parseScriptureRef("Epictetus 3.22", "Epictetus", 3)).toEqual({
			path: [3, 22],
			end: 22,
			full: false,
		});
	});

	test("reads one-level and three-level refs", () => {
		expect(parseScriptureRef("Dhp 183", "Dhp", 1)).toEqual({ path: [183], end: 183, full: true });
		expect(parseScriptureRef("58-59", "Dhp", 1)).toEqual({ path: [58], end: 59, full: true });
		expect(parseScriptureRef("Japji 0", "Japji", 1)).toEqual({ path: [0], end: 0, full: true });
		expect(parseScriptureRef("3.22.45", "Epictetus", 3)).toEqual({
			path: [3, 22, 45],
			end: 45,
			full: true,
		});
	});

	test("rejects text that is not a reference, too many levels, or a range above the final level", () => {
		for (const bad of ["", "abc", "2.", "2.47-40", "1.1.1", "Analects 1,1", "12345", "2-3"]) {
			expect(parseScriptureRef(bad, "Analects", 2)).toBeNull();
		}
		expect(parseScriptureRef("3.22.5.1", "Epictetus", 3)).toBeNull();
		expect(parseScriptureRef("3.22-23", "Epictetus", 3)).toBeNull();
	});

	test("rejects a range over the maximum", () => {
		expect(parseScriptureRef(`1-${MAX_RANGE}`, "Dhp", 1)).not.toBeNull();
		expect(parseScriptureRef(`1-${MAX_RANGE + 1}`, "Dhp", 1)).toBeNull();
	});
});
