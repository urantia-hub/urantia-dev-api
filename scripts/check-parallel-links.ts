// Reads the real page behind the address of a sample of parallel passages, and says for each work how
// many pages opened and how many hold the first words of the passage. Run it after a change to
// `src/lib/parallel-links.ts`, and when a work is added:  bun scripts/check-parallel-links.ts
// It asks the live API for the passages and builds each address with the code of this checkout.
import { bibleUrl, scriptureUrl, textFragment } from "../src/lib/parallel-links.ts";

const API = process.env.API_BASE_URL ?? "https://api.urantia.dev";
const REFS = (process.env.REFS ?? "1:0.3,2:5.1,3:1.4,5:1.6,12:4.3,34:6.11,48:6.33,74:6.3,100:4.3,111:4.5,121:8.3,131:3.2,131:8.3,140:5.7,159:5.2,170:2.6,195:9.3,196:0.5").split(",");
const AGENT = { "user-agent": "Mozilla/5.0 (urantia.dev link check)" };

type Passage = { work: string; reference: string; text: string; url: string | null };
const pages = new Map<string, Promise<string | null>>();

// The visible text of a page: no tags, entities as characters, one space between words.
function plain(html: string): string {
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;|&#160;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&rsquo;|’/g, "'")
		.replace(/&[lr]dquo;|[“”]/g, '"')
		.replace(/\s+/g, " ");
}
const same = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");

function page(url: string): Promise<string | null> {
	const address = url.split("#")[0] as string;
	let found = pages.get(address);
	if (!found) {
		found = fetch(address, { headers: AGENT, redirect: "follow" })
			.then(async (res) => (res.ok ? plain(await res.text()) : null))
			.catch(() => null);
		pages.set(address, found);
	}
	return found;
}

const passages: Passage[] = [];
for (const ref of REFS) {
	const res = await fetch(`${API}/paragraphs/${ref}?include=bibleParallels,scriptureParallels`, { headers: AGENT });
	if (!res.ok) throw new Error(`${ref}: the API answered ${res.status}`);
	const data = ((await res.json()) as { data: { bibleParallels?: any[]; scriptureParallels?: any[] } }).data;
	for (const b of data.bibleParallels ?? []) passages.push({ work: "bible", reference: b.reference, text: b.text, url: bibleUrl(b.bookCode, b.chapter, b.verseStart) });
	for (const s of data.scriptureParallels ?? []) passages.push({ work: s.corpus.id, reference: s.reference, text: s.text, url: scriptureUrl(s.corpus.id, s.reference, s.text) });
}

const results = new Map<string, { all: number; noUrl: number; noPage: number; found: number; missed: string[] }>();
const seen = new Set<string>();
for (const p of passages) {
	const key = `${p.work} ${p.reference}`;
	if (seen.has(key)) continue;
	seen.add(key);
	const r = results.get(p.work) ?? { all: 0, noUrl: 0, noPage: 0, found: 0, missed: [] };
	results.set(p.work, r);
	r.all += 1;
	if (!p.url) {
		r.noUrl += 1;
		continue;
	}
	const text = await page(p.url);
	if (text === null) {
		r.noPage += 1;
		r.missed.push(`${p.reference}: no page at ${p.url.split("#")[0]}`);
		continue;
	}
	const words = same(decodeURIComponent(textFragment(p.text).replace("#:~:text=", "")));
	if (words && text.includes(words)) r.found += 1;
	else r.missed.push(`${p.reference}: "${words}"`);
}

let bad = false;
for (const [work, r] of results) {
	console.log(`${work}: ${r.all} passages, ${r.noUrl} with no address, ${r.noPage} with no page, ${r.found} with the words on the page`);
	for (const line of r.missed.slice(0, 6)) console.log(`    ${line}`);
	if (r.noPage > 0) bad = true;
}
// A page that does not open is a wrong link. Words that differ only cost the scroll to the passage.
process.exit(bad ? 1 : 0);
