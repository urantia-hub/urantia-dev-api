// Applies a reviewed fixes file to the English entity data and writes the SQL for the database.
// Usage: bun scripts/apply-entity-fixes.ts data/entities/fixes/<date>.json
// The seed only updates descriptions, so names, types, aliases, merges and removals need the SQL.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Fix =
	| { action: "ok" }
	| {
			action: "fix";
			name?: string;
			type?: string;
			aliases?: string[];
			description?: string;
			reason: string;
			refs?: string[];
	  }
	| { action: "merge"; into: string; reason: string; refs?: string[] }
	| { action: "remove"; reason: string };

type SeedEntity = {
	id: string;
	name: string;
	type: string;
	aliases: string[];
	description: string;
	seeAlso: string[];
	citations: string[];
};
type Mention = { id: string; name: string; type: string };

const TYPES = new Set(["being", "place", "order", "race", "religion", "concept"]);
const dir = join(import.meta.dir, "../data/entities");
const fixesPath = process.argv[2];
if (!fixesPath) throw new Error("usage: bun scripts/apply-entity-fixes.ts <fixes.json>");

const fixes: Record<string, Fix> = JSON.parse(readFileSync(fixesPath, "utf-8"));
const seed: SeedEntity[] = JSON.parse(readFileSync(join(dir, "seed-entities.json"), "utf-8"));
const mentions: Record<string, Mention[]> = JSON.parse(
	readFileSync(join(dir, "paragraph-entities.json"), "utf-8"),
);
const byId = new Map(seed.map((e) => [e.id, e]));

const uniq = (xs: string[]) => [...new Set(xs)];
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const arr = (xs: string[]) => (xs.length ? `ARRAY[${xs.map(q).join(", ")}]::text[]` : "NULL");
const sql: string[] = ["BEGIN;"];
const gone = new Map<string, string | null>(); // removed or merged id -> id that replaces it

for (const [id, fix] of Object.entries(fixes)) {
	const e = byId.get(id);
	if (!e) throw new Error(`unknown id ${id}`);
	if (fix.action === "fix") {
		if (fix.type && !TYPES.has(fix.type)) throw new Error(`${id}: bad type ${fix.type}`);
		if (fix.name !== undefined) e.name = fix.name;
		if (fix.type !== undefined) e.type = fix.type;
		if (fix.aliases !== undefined) e.aliases = uniq(fix.aliases.filter((a) => a !== e.name));
		if (fix.description !== undefined) e.description = fix.description;
		sql.push(
			`UPDATE entities SET name = ${q(e.name)}, type = ${q(e.type)}, aliases = ${arr(e.aliases)}, description = ${q(e.description)} WHERE id = ${q(id)};`,
		);
	} else if (fix.action === "merge") {
		const into = byId.get(fix.into);
		if (!into) throw new Error(`${id}: unknown merge target ${fix.into}`);
		if (fixes[fix.into] && fixes[fix.into].action !== "ok" && fixes[fix.into].action !== "fix")
			throw new Error(`${id}: merge target ${fix.into} is itself merged or removed`);
		into.aliases = uniq([...into.aliases, e.name, ...e.aliases]).filter((a) => a !== into.name);
		into.citations = uniq([...into.citations, ...e.citations]);
		gone.set(id, fix.into);
	} else if (fix.action === "remove") {
		gone.set(id, null);
	}
}

// Merge targets: aliases and links move to the record that stays.
const targets = new Set([...gone.values()].filter((v): v is string => v !== null));
for (const t of targets) {
	const e = byId.get(t) as SeedEntity;
	sql.push(`UPDATE entities SET aliases = ${arr(e.aliases)} WHERE id = ${q(t)};`);
}
for (const [id, into] of gone) {
	if (into) {
		sql.push(
			`INSERT INTO paragraph_entities (paragraph_id, entity_id) SELECT paragraph_id, ${q(into)} FROM paragraph_entities WHERE entity_id = ${q(id)} ON CONFLICT DO NOTHING;`,
		);
	}
	sql.push(`DELETE FROM paragraph_entities WHERE entity_id = ${q(id)};`);
	sql.push(`DELETE FROM entity_translations WHERE entity_id = ${q(id)};`);
	sql.push(`DELETE FROM entities WHERE id = ${q(id)};`);
}
for (const t of targets) {
	sql.push(
		`UPDATE entities SET citation_count = (SELECT count(*) FROM paragraph_entities WHERE entity_id = ${q(t)}) WHERE id = ${q(t)};`,
	);
}
sql.push("COMMIT;");

// seed-entities.json: drop gone records and repoint seeAlso.
const kept = seed
	.filter((e) => !gone.has(e.id))
	.map((e) => ({
		...e,
		seeAlso: uniq(
			e.seeAlso.map((s) => (gone.has(s) ? gone.get(s) : s)).filter((s): s is string => !!s && s !== e.id),
		),
	}));

// paragraph-entities.json: new names and types, merged ids repointed, removed ids dropped.
for (const [ref, list] of Object.entries(mentions)) {
	const out: Mention[] = [];
	for (const m of list) {
		const id = gone.has(m.id) ? gone.get(m.id) : m.id;
		if (!id || out.some((o) => o.id === id)) continue;
		const e = byId.get(id);
		out.push(e ? { id, name: e.name, type: e.type } : m);
	}
	mentions[ref] = out;
}

writeFileSync(join(dir, "seed-entities.json"), JSON.stringify(kept, null, 2));
writeFileSync(join(dir, "paragraph-entities.json"), JSON.stringify(mentions, null, 2));
const sqlPath = fixesPath.replace(/\.json$/, ".sql");
writeFileSync(sqlPath, `${sql.join("\n")}\n`);
console.log(`${seed.length} -> ${kept.length} entities; ${gone.size} merged or removed; SQL: ${sqlPath}`);
