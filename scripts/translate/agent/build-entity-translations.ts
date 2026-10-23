/**
 * build-entity-translations.ts — Rebuild a language's entity names from the clean glossary.
 *
 * Usage:
 *   bun scripts/translate/agent/build-entity-translations.ts --lang=es <out.sql>
 *
 * Writes data/translations/<lang>/entity-translations.json with the glossary name and aliases
 * of each entity, and no description: the old file was made with the Foundation text as context.
 * The SQL replaces every urantia.dev row of the language in one transaction. An entity with no
 * glossary entry gets no row, so the API shows its English name.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadGlossary, parseArgs, ROOT } from "./lib.ts";

const { lang } = parseArgs();
const out = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!out) throw new Error("Give the path of the SQL file to write.");

type Seed = { id: string };
const ids = new Set(
	(JSON.parse(readFileSync(join(ROOT, "data/entities/seed-entities.json"), "utf-8")) as Seed[]).map(
		(e) => e.id,
	),
);
const glossary = loadGlossary(lang);

// The glossary rates the form; a low form is not safe to show without a look.
const confidence = (c: string | null | undefined) =>
	c === "high" ? "high" : c === "low" ? "needs_manual" : "medium";

const rows = Object.entries(glossary)
	.filter(([id]) => ids.has(id))
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([id, g]) => ({
		entityId: id,
		language: lang,
		source: "urantia.dev",
		version: 1,
		name: g.name,
		aliases: (g.aliases ?? []).filter((a) => a && a !== g.name),
		description: null,
		confidence: confidence(g.formConfidence ?? g.confidence),
	}));

writeFileSync(
	join(ROOT, `data/translations/${lang}/entity-translations.json`),
	`${JSON.stringify(rows, null, "\t")}\n`,
);

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const values = rows.map(
	(r) =>
		`(${q(r.entityId)}, ${q(r.name)}, ${r.aliases.length ? `ARRAY[${r.aliases.map(q).join(", ")}]` : "NULL"}::text[], ${q(r.confidence)})`,
);
writeFileSync(
	out,
	`BEGIN;
DELETE FROM entity_translations WHERE language = ${q(lang)} AND source = 'urantia.dev';
INSERT INTO entity_translations (id, entity_id, language, source, version, name, aliases, description, confidence)
SELECT v.entity_id || ':${lang}:urantia.dev:v1', v.entity_id, ${q(lang)}, 'urantia.dev', 1, v.name, v.aliases, NULL, v.confidence
FROM (VALUES
${values.join(",\n")}
) AS v (entity_id, name, aliases, confidence)
JOIN entities e ON e.id = v.entity_id;
COMMIT;
`,
);
console.log(`${rows.length} of ${ids.size} entities have a clean ${lang} name. SQL: ${out}`);
