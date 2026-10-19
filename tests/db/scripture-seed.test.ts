import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { CORPORA } from "../../scripts/scriptures/corpora.ts";

// seed.ts on a local database with the scripture tables (drizzle-kit push). Without one (as in CI), it skips.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const client = local ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const suite = client ? describe : describe.skip;

const corpus = CORPORA.find((c) => c.id === "japji-macauliffe-1909");
const passage = (ref: string, sort: number) => ({
	ref,
	sort,
	division: 1,
	divisionTitle: null,
	text: `The text of ${ref}, long enough to stand as its own passage in a chunk.`,
});
const seed = (passages: ReturnType<typeof passage>[]) => {
	const dir = mkdtempSync(join(tmpdir(), "seed-"));
	writeFileSync(join(dir, `${corpus?.id}.json`), JSON.stringify({ corpus, passages }));
	const run = Bun.spawnSync(["bun", "scripts/scriptures/seed.ts", dir], {
		env: { ...process.env, DATABASE_URL: url, ONLY: corpus?.id },
	});
	if (run.exitCode !== 0) throw new Error(run.stderr.toString());
};

suite("seed.ts", () => {
	afterAll(() => client?.end());

	it("removes a passage that the new build no longer makes", async () => {
		seed([passage("Japji 1-2", 1), passage("Japji 3", 3)]);
		seed([passage("Japji 1", 1), passage("Japji 2", 2), passage("Japji 3", 3)]);
		const rows = await (client as postgres.Sql)<{ ref: string }[]>`
			SELECT ref FROM scripture_passages WHERE corpus_id = ${corpus?.id as string} ORDER BY sort, ref`;
		expect(rows.map((r) => r.ref)).toEqual(["Japji 1", "Japji 2", "Japji 3"]);
	});
});
