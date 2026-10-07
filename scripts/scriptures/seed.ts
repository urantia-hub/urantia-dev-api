// Seeds scripture_corpora, scripture_chunks, and scripture_passages from the
// JSON that build.ts writes. Re-runnable: rows are upserted by id, and an
// existing embedding is kept when the chunk text is unchanged.
// Run: DATABASE_URL=... bun scripts/scriptures/seed.ts [dataDir]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { chunkPassages, refNumbers } from "./chunk.ts";
import { CORPORA, type Corpus } from "./corpora.ts";
import type { Passage } from "./parsers.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const DIR =
	process.argv[2] ?? join(import.meta.dir, "../../../urantia-data-sources/data/scriptures");

const sql = postgres(DATABASE_URL, { max: 2 });

for (const [order, corpus] of CORPORA.entries()) {
	const file = JSON.parse(readFileSync(join(DIR, `${corpus.id}.json`), "utf8")) as {
		corpus: Corpus;
		passages: Passage[];
	};
	const passages = file.passages;
	const chunks = chunkPassages(passages, corpus.chunkBy === "division");
	const chunkOf = new Map<string, string>();
	for (const c of chunks) for (const r of c.refs) chunkOf.set(r, `${corpus.id}:${c.refs[0]}`);

	await sql.begin(async (tx) => {
		await tx`
			INSERT INTO scripture_corpora ${tx({
				id: corpus.id,
				slug: corpus.slug,
				ref_prefix: corpus.refPrefix,
				religion: corpus.religion,
				title: corpus.title,
				translator: corpus.translator,
				year: corpus.year,
				source_url: corpus.source,
				license: corpus.license,
				urantia_section: corpus.urantiaSection,
				division_label: corpus.divisionLabel,
				unit_label: corpus.unitLabel,
				passage_count: passages.length,
				sort_order: order + 1,
				ref_levels: corpus.refLevels,
				notes: corpus.notes,
			})}
			ON CONFLICT (id) DO UPDATE SET
				slug = EXCLUDED.slug, ref_prefix = EXCLUDED.ref_prefix, religion = EXCLUDED.religion,
				title = EXCLUDED.title, translator = EXCLUDED.translator, year = EXCLUDED.year,
				source_url = EXCLUDED.source_url, license = EXCLUDED.license,
				urantia_section = EXCLUDED.urantia_section, division_label = EXCLUDED.division_label,
				unit_label = EXCLUDED.unit_label, passage_count = EXCLUDED.passage_count,
				sort_order = EXCLUDED.sort_order, ref_levels = EXCLUDED.ref_levels, notes = EXCLUDED.notes`;

		const chunkRows = chunks.map((c) => ({
			id: `${corpus.id}:${c.refs[0]}`,
			corpus_id: corpus.id,
			label: c.label,
			sort_start: c.sortStart,
			sort_end: c.sortEnd,
			text: c.text,
		}));
		for (let i = 0; i < chunkRows.length; i += 500) {
			await tx`
				INSERT INTO scripture_chunks ${tx(chunkRows.slice(i, i + 500))}
				ON CONFLICT (id) DO UPDATE SET
					label = EXCLUDED.label, sort_start = EXCLUDED.sort_start, sort_end = EXCLUDED.sort_end,
					text = EXCLUDED.text,
					embedding = CASE WHEN scripture_chunks.text = EXCLUDED.text THEN scripture_chunks.embedding END,
					embedding_small = CASE WHEN scripture_chunks.text = EXCLUDED.text THEN scripture_chunks.embedding_small END,
					embedding_model = CASE WHEN scripture_chunks.text = EXCLUDED.text THEN scripture_chunks.embedding_model END`;
		}

		const passageRows = passages.map((p) => {
			const { start, end } = refNumbers(p.ref);
			return {
				id: `${corpus.id}:${p.ref}`,
				corpus_id: corpus.id,
				ref: p.ref,
				sort: p.sort,
				division: Number(p.division),
				division_title: p.divisionTitle,
				subdivision: p.subdivision ?? null,
				number_start: start,
				number_end: end,
				text: p.text,
				chunk_id: chunkOf.get(p.ref) ?? null,
			};
		});
		for (let i = 0; i < passageRows.length; i += 500) {
			await tx`
				INSERT INTO scripture_passages ${tx(passageRows.slice(i, i + 500))}
				ON CONFLICT (id) DO UPDATE SET
					ref = EXCLUDED.ref, sort = EXCLUDED.sort, division = EXCLUDED.division,
					division_title = EXCLUDED.division_title, subdivision = EXCLUDED.subdivision, number_start = EXCLUDED.number_start,
					number_end = EXCLUDED.number_end, text = EXCLUDED.text, chunk_id = EXCLUDED.chunk_id`;
		}

		// Remove the chunks this build no longer makes, and their parallels.
		const keep = chunkRows.map((c) => c.id);
		const stale = await tx`
			SELECT id FROM scripture_chunks WHERE corpus_id = ${corpus.id} AND NOT (id = ANY(${keep}))`;
		if (stale.length) {
			const ids = stale.map((s) => s.id as string);
			await tx`DELETE FROM scripture_parallels WHERE chunk_id = ANY(${ids})`;
			await tx`DELETE FROM scripture_chunks WHERE id = ANY(${ids})`;
			console.log(`${corpus.id}: removed ${ids.length} stale chunks`);
		}
	});
	console.log(`${corpus.id}: ${passages.length} passages, ${chunks.length} chunks`);
}
await sql.end();
