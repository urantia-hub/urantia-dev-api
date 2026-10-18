import { describe, expect, it } from "bun:test";
import {
	OLDER_WORDS,
	olderTsQuery,
	olderWords,
	phraseVariants,
} from "../../src/lib/older-words.ts";
import { normalizeQuery } from "../../src/lib/search-text.ts";

describe("older words", () => {
	it("adds the older word to a listed word in a tsquery, and keeps the prefix on the last word", () => {
		expect(olderTsQuery(["jesus", "pigs"], "&", true)).toBe("jesus & (pigs:* | swine)");
		expect(olderTsQuery(["pigs", "jesus"], "&", false)).toBe("(pigs | swine) & jesus");
		expect(olderTsQuery(["love"], "&", true)).toBe("love:*");
	});
	it("gives each phrase with the listed words swapped", () => {
		expect(phraseVariants(["herd", "of", "pigs"])).toEqual(["herd of pigs", "herd of swine"]);
		expect(phraseVariants(["love"])).toEqual(["love"]);
	});
	it("keeps the number of phrases small", () => {
		expect(phraseVariants(Array(12).fill("pigs"))).toHaveLength(8);
	});
	it("names each older word once, and not a word that the query already has", () => {
		expect(olderWords(["pigs", "hogs"])).toEqual(["swine"]);
		expect(olderWords(["pigs", "swine"])).toEqual([]);
	});
	it("holds only normalized words, so each one is safe in a tsquery", () => {
		for (const [word, older] of Object.entries(OLDER_WORDS)) {
			for (const w of [word, ...older]) expect(normalizeQuery(w).words).toEqual([w]);
		}
	});
});
