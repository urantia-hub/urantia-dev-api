import { describe, expect, it } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { paragraphEntities } from "../../src/db/schema.ts";

// The seed inserts with onConflictDoNothing, which only works when a key exists.
describe("paragraph_entities key", () => {
	it("has a primary key on (paragraph_id, entity_id)", () => {
		const keys = getTableConfig(paragraphEntities).primaryKeys;
		expect(keys).toHaveLength(1);
		expect(keys[0]?.columns.map((c) => c.name)).toEqual(["paragraph_id", "entity_id"]);
		expect(keys[0]?.getName()).toBe("paragraph_entities_paragraph_id_entity_id_pk");
	});
});
