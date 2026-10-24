import { describe, expect, it } from "bun:test";
import { referenceIn } from "../../src/lib/paper-semantic.ts";

// Semantic search reads a reference as keyword search does in the same language.
describe("referenceIn", () => {
	it("reads a Spanish-style reference with lang=es", () => {
		expect(referenceIn("documento 1:0.1", "es")).toEqual(referenceIn("1:0.1", "eng"));
		expect(referenceIn("documento 1", "es")).toEqual(referenceIn("paper 1", "eng"));
	});
	it("keeps the English reading for English", () => {
		expect(referenceIn("paper 1:0.1", "eng")).toEqual(referenceIn("1:0.1", "eng"));
		expect(referenceIn("1:0.1", "es")).toEqual(referenceIn("1:0.1", "eng"));
	});
	it("gives null for a question", () => {
		expect(referenceIn("¿Qué es el alma?", "es")).toBeNull();
	});
});
