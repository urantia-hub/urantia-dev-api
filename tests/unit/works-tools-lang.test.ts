import { describe, expect, it } from "bun:test";
import { TOOL_CATALOG } from "../../src/lib/tool-catalog.ts";

const tool = (name: string) => TOOL_CATALOG.find((t) => t.name === name);

describe("the works tools take lang", () => {
	for (const name of ["list_works", "read_work", "list_bible_books"]) {
		it(`${name} has lang eng or es`, () => {
			const lang = tool(name)?.parameters.properties.lang;
			expect(lang?.enum).toEqual(["eng", "es"]);
			expect(lang?.default).toBe("eng");
			expect(lang?.description).toContain("stays English");
		});
	}

	it("the parallels tool takes no lang", () => {
		expect(tool("get_work_urantia_parallels")?.parameters.properties.lang).toBeUndefined();
	});
});
