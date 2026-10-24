import { describe, expect, it } from "bun:test";
import { localizeIncluded } from "../../src/lib/translations.ts";

// A db whose every select finds no row: each item has no Spanish form.
const emptyDb = { select: () => ({ from: () => ({ where: async () => [] }) }) };

const row = {
	id: "p1",
	entities: [{ id: "universal-father", name: "Universal Father", type: "being" }],
	urantiaParallels: [
		{ id: "x", standardReferenceId: "1:1.4", paperId: "1", paperTitle: "The Universal Father", sectionTitle: "The Paternal Name", text: "* * *", similarity: 0.9, rank: 1, source: "semantic", embeddingModel: "m" },
	],
};

describe("localizeIncluded", () => {
	it("returns English rows unchanged for eng", async () => {
		expect(await localizeIncluded(emptyDb, [row], "eng")).toEqual([row]);
	});
	it("keeps the English of an item with no Spanish row and marks it eng", async () => {
		const [out] = await localizeIncluded(emptyDb, [row], "es");
		expect(out!.urantiaParallels[0]).toMatchObject({ text: "* * *", paperTitle: "The Universal Father", sectionTitle: "The Paternal Name", language: "eng" });
		expect(out!.entities[0]).toMatchObject({ name: "Universal Father", language: "eng" });
		expect(out!.urantiaParallels).toHaveLength(1);
	});
	it("leaves a row with no includes alone", async () => {
		const bare: { id: string; entities?: { id: string; name: string }[] } = { id: "p2" };
		expect(await localizeIncluded(emptyDb, [bare], "es")).toEqual([bare]);
	});
});
