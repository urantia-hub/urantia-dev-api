import { describe, expect, it } from "bun:test";
import { strengthOf } from "../../src/lib/search-strength.ts";

describe("strengthOf", () => {
	it("names the band of a similarity", () => {
		expect(strengthOf(0.86, "papers")).toBe("strong");
		expect(strengthOf(0.66, "papers")).toBe("strong");
		expect(strengthOf(0.62, "papers")).toBe("related");
		expect(strengthOf(0.41, "papers")).toBe("weak");
	});
});
