import { describe, expect, it } from "bun:test";
import { mcpSearchFields } from "../../src/lib/request-log.ts";

describe("mcpSearchFields", () => {
	it("gives the count and the match kinds of a keyword search", () => {
		const fields = mcpSearchFields("search.fulltext", "es", {
			data: [{ match: "exact" }, { match: "all" }, { match: "all" }],
			meta: { total: 42, didYouMean: "soul" },
		});
		expect(fields).toEqual({
			mcp_tool: "search.fulltext",
			lang: "es",
			result_count: 42,
			related_count: undefined,
			first_match: "exact",
			first_strength: undefined,
			tier_counts: { exact: 1, all: 2 },
			did_you_mean: true,
		});
	});

	it("gives the related count and first strength of a semantic search", () => {
		const fields = mcpSearchFields("search.semantic", undefined, {
			data: [{ match: "similar", strength: "strong" }],
			meta: { total: 100, related: 12 },
		});
		expect(fields.lang).toBe("eng");
		expect(fields.related_count).toBe(12);
		expect(fields.first_strength).toBe("strong");
		expect(fields.did_you_mean).toBe(false);
	});

	it("logs zero for a search that finds nothing", () => {
		const fields = mcpSearchFields("works.search", undefined, { data: [], meta: { total: 0 } });
		expect(fields.result_count).toBe(0);
		expect(fields.first_match).toBeUndefined();
		expect(fields.tier_counts).toEqual({});
	});

	it("holds no search words, not even the fixed query", () => {
		const fields = mcpSearchFields("search.fulltext", "eng", {
			data: [{ match: "near" }],
			meta: { total: 1, didYouMean: "nebadon" },
		});
		expect(JSON.stringify(fields)).not.toContain("nebadon");
	});
});
