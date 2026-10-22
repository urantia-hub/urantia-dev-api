import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Adds .openapi() to zod, which the schemas file uses.
import "@hono/zod-openapi";
import { EntitySchema } from "../../src/validators/schemas.ts";

type SeedEntity = { id: string; name: string; type: string; sense?: string };
const seed: SeedEntity[] = JSON.parse(
	readFileSync(join(import.meta.dir, "../../data/entities/seed-entities.json"), "utf-8"),
);

// The Hub leaves "ordinary" concepts out of its term list, so each lowercase concept needs a sense.
describe("entity sense", () => {
	it("marks every lowercase concept and nothing else", () => {
		for (const e of seed) {
			const lowercaseConcept = e.type === "concept" && /^[a-z]/.test(e.name);
			if (lowercaseConcept)
				expect([e.id, e.sense]).toEqual([e.id, expect.stringMatching(/^(special|ordinary)$/)]);
			else expect([e.id, e.sense]).toEqual([e.id, undefined]);
		}
	});

	it("is in the response schema and accepts null", () => {
		const base = {
			id: "x",
			name: "x",
			type: "concept",
			aliases: null,
			description: null,
			seeAlso: null,
			citationCount: 0,
		};
		expect(EntitySchema.safeParse({ ...base, sense: "ordinary" }).success).toBe(true);
		expect(EntitySchema.safeParse({ ...base, sense: null }).success).toBe(true);
		expect(EntitySchema.safeParse({ ...base, sense: "plain" }).success).toBe(false);
	});
});
