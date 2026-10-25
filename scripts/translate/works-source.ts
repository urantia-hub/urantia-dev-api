// The English words of the works catalog, from the live public API (read only), for a translation of
// data/translations/es/works.json. Usage: bun scripts/translate/works-source.ts <out-dir> (never the repo).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = process.env.API_BASE ?? "https://api.urantia.dev";
const UA = { "User-Agent": "urantia-dev-api/works-source" };
const out = process.argv[2];
if (!out) throw new Error("usage: bun scripts/translate/works-source.ts <out-dir>");
mkdirSync(out, { recursive: true });

async function get(path: string) {
	const res = await fetch(`${API}${path}`, { headers: UA });
	if (!res.ok) throw new Error(`${path}: ${res.status}`);
	return res.json() as Promise<{ data: any }>;
}

const works = (await get("/works")).data;
const corpora = (await get("/scriptures")).data;
const books = (await get("/bible/books")).data;
const titles: Record<string, string[]> = {};
for (const c of corpora) {
	const d = (await get(`/scriptures/${c.slug}`)).data;
	const seen = new Set<string>();
	for (const x of [...d.divisions, ...d.pages]) if (x.title) seen.add(x.title);
	if (seen.size) titles[c.slug] = [...seen];
}
writeFileSync(
	join(out, "works-source.json"),
	JSON.stringify({ works, corpora, books, titles }, null, 1),
);
console.log(
	`${works.length} works, ${books.length} books, ${Object.values(titles).flat().length} titles`,
);
