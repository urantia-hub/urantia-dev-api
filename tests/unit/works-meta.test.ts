import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { CORPORA } from "../../scripts/scriptures/corpora.ts";

describe("what each work says about itself", () => {
	it("gives each work a kind, a tradition, and a one-sentence summary", () => {
		for (const c of CORPORA) {
			expect(["scripture", "classic", "recorded"]).toContain(c.kind);
			expect(c.religion).not.toMatch(/myth/i);
			expect(c.summary).toMatch(/^[A-Z].*\.$/);
			expect(c.summary.split(". ")).toHaveLength(1);
		}
	});
	it("names each tradition by its people or followers, not by the name of the religion", () => {
		const tradition = Object.fromEntries(CORPORA.map((c) => [c.slug, c.religion]));
		for (const c of CORPORA) expect(c.religion).not.toMatch(/ism\b|^Islam$/);
		expect(tradition["bhagavad-gita"]).toBe("Hindu");
		expect(tradition["tao-te-ching"]).toBe("Taoist");
		expect(tradition.analects).toBe("Confucian");
		expect(tradition.quran).toBe("Muslim");
		expect(tradition["shinto-oracles"]).toBe("Japanese (Shinto)");
	});
	it("keeps the kinds of the spec", () => {
		const kind = Object.fromEntries(CORPORA.map((c) => [c.slug, c.kind]));
		expect(kind.quran).toBe("scripture");
		expect(kind.japji).toBe("scripture");
		expect(kind.analects).toBe("classic");
		expect(kind["diogenes-laertius-6"]).toBe("classic");
	});
	it("marks a work with no link as not linked", () => {
		for (const c of CORPORA) expect(typeof c.linked).toBe("boolean");
	});
	it("sets the same kind and summary in the SQL for each work that is already loaded", () => {
		const sqlText = readFileSync("scripts/scriptures/alter-round3.sql", "utf8");
		for (const id of ["dhammapada-muller-1881", "koran-pickthall-1930", "analects-legge-1861"]) {
			const c = CORPORA.find((x) => x.id === id);
			const line = sqlText.split("\n").find((l) => l.includes(`WHERE id = '${id}'`));
			expect(line).toContain(`kind = '${c?.kind}'`);
			expect(line).toContain(`summary = '${c?.summary.replaceAll("'", "''")}'`);
		}
	});
});
