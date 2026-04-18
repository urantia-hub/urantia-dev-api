import { describe, expect, it } from "bun:test";
import {
	aggregateTopEntities,
	wantsEntities,
	wantsTopEntities,
} from "../../src/lib/entities.ts";

describe("wantsEntities", () => {
	it("returns true for exact 'entities'", () => {
		expect(wantsEntities("entities")).toBe(true);
	});

	it("returns true when 'entities' is one of several comma-separated tokens", () => {
		expect(wantsEntities("foo,entities,bar")).toBe(true);
		expect(wantsEntities("entities,topEntities")).toBe(true);
	});

	it("tolerates surrounding whitespace in comma-split tokens", () => {
		expect(wantsEntities(" entities ")).toBe(true);
		expect(wantsEntities("foo, entities ,bar")).toBe(true);
	});

	it("returns false when absent", () => {
		expect(wantsEntities(undefined)).toBe(false);
		expect(wantsEntities("")).toBe(false);
		expect(wantsEntities("topEntities")).toBe(false);
		expect(wantsEntities("foo,bar")).toBe(false);
	});

	it("is case-sensitive", () => {
		expect(wantsEntities("ENTITIES")).toBe(false);
		expect(wantsEntities("Entities")).toBe(false);
	});
});

describe("wantsTopEntities", () => {
	it("returns true for exact 'topEntities'", () => {
		expect(wantsTopEntities("topEntities")).toBe(true);
	});

	it("returns true when combined with 'entities' in comma list", () => {
		expect(wantsTopEntities("entities,topEntities")).toBe(true);
		expect(wantsTopEntities("topEntities,entities")).toBe(true);
	});

	it("tolerates surrounding whitespace", () => {
		expect(wantsTopEntities(" topEntities ")).toBe(true);
		expect(wantsTopEntities("entities, topEntities ")).toBe(true);
	});

	it("returns false when absent or empty", () => {
		expect(wantsTopEntities(undefined)).toBe(false);
		expect(wantsTopEntities("")).toBe(false);
	});

	it("does not match 'entities' alone", () => {
		expect(wantsTopEntities("entities")).toBe(false);
	});

	it("is case-sensitive (lowercase does not match)", () => {
		expect(wantsTopEntities("topentities")).toBe(false);
		expect(wantsTopEntities("TOPENTITIES")).toBe(false);
	});
});

describe("aggregateTopEntities", () => {
	const mk = (id: string, name: string, type: string) => ({ id, name, type });

	it("returns empty array for empty input", () => {
		expect(aggregateTopEntities([])).toEqual([]);
	});

	it("returns empty array when no paragraph has entities", () => {
		const paragraphs = [{ entities: [] }, { entities: undefined }, {}];
		expect(aggregateTopEntities(paragraphs)).toEqual([]);
	});

	it("dedupes by entity id across paragraphs and counts occurrences", () => {
		const result = aggregateTopEntities([
			{ entities: [mk("father", "Universal Father", "being")] },
			{ entities: [mk("father", "Universal Father", "being")] },
			{ entities: [mk("father", "Universal Father", "being")] },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: "father",
			name: "Universal Father",
			type: "being",
			count: 3,
		});
	});

	it("sorts by count descending", () => {
		const result = aggregateTopEntities([
			{ entities: [mk("a", "A", "being")] },
			{ entities: [mk("b", "B", "being"), mk("c", "C", "being")] },
			{ entities: [mk("b", "B", "being")] },
			{ entities: [mk("b", "B", "being")] },
			{ entities: [mk("c", "C", "being")] },
		]);
		expect(result.map((e) => e.id)).toEqual(["b", "c", "a"]);
		expect(result.map((e) => e.count)).toEqual([3, 2, 1]);
	});

	it("tier-ranks being/place/concept above order/race/religion on count tie", () => {
		const result = aggregateTopEntities([
			{
				entities: [
					mk("sera", "Seraphim", "order"),
					mk("father", "Universal Father", "being"),
					mk("para", "Paradise", "place"),
					mk("morontia", "Morontia", "concept"),
					mk("nodites", "Nodites", "race"),
					mk("christianity", "Christianity", "religion"),
				],
			},
		]);
		// All count=1. Expected: being/place/concept (tier 0) before order/race/religion (tier 1).
		const tier0Ids = result.slice(0, 3).map((e) => e.id);
		expect(tier0Ids.sort()).toEqual(["father", "morontia", "para"]);
		const tier1Ids = result.slice(3).map((e) => e.id);
		expect(tier1Ids.sort()).toEqual(["christianity", "nodites", "sera"]);
	});

	it("tie-breaks by name alphabetically within same tier+count", () => {
		const result = aggregateTopEntities([
			{
				entities: [
					mk("zeta", "Zeta", "being"),
					mk("alpha", "Alpha", "being"),
					mk("mu", "Mu", "being"),
				],
			},
		]);
		expect(result.map((e) => e.name)).toEqual(["Alpha", "Mu", "Zeta"]);
	});

	it("respects explicit limit parameter", () => {
		const entities = Array.from({ length: 20 }, (_, i) =>
			mk(`id-${i}`, `Name ${i}`, "being"),
		);
		const result = aggregateTopEntities([{ entities }], 5);
		expect(result).toHaveLength(5);
	});

	it("defaults limit to 12", () => {
		const entities = Array.from({ length: 20 }, (_, i) =>
			mk(`id-${i}`, `Name ${i}`, "being"),
		);
		const result = aggregateTopEntities([{ entities }]);
		expect(result).toHaveLength(12);
	});

	it("handles mixed shape (some paragraphs with entities, some without)", () => {
		const result = aggregateTopEntities([
			{ entities: [mk("a", "A", "being")] },
			{},
			{ entities: undefined },
			{ entities: [mk("a", "A", "being"), mk("b", "B", "concept")] },
		]);
		expect(result.map((e) => e.id)).toEqual(["a", "b"]);
		expect(result.map((e) => e.count)).toEqual([2, 1]);
	});
});
