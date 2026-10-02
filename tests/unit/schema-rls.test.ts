import { describe, expect, it } from "bun:test";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../src/db/schema.ts";

/**
 * Every table must declare RLS in the schema.
 *
 * `bun run db:push` compares the schema with the database. A table without
 * `.enableRLS()` gets `DISABLE ROW LEVEL SECURITY` on the next push, which
 * opens it to Supabase's PostgREST surface.
 */
const tables: Array<[string, PgTable]> = [];
for (const [name, value] of Object.entries(schema)) {
	if (value instanceof PgTable) tables.push([name, value]);
}

describe("schema RLS", () => {
	it("finds the tables", () => {
		expect(tables.length).toBeGreaterThanOrEqual(24);
	});

	for (const [name, table] of tables) {
		it(`${name} declares .enableRLS()`, () => {
			expect(getTableConfig(table).enableRLS).toBe(true);
		});
	}
});
