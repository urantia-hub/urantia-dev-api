// Reads the real page behind the address of a sample of parallel passages, and says for each work how
// many pages opened and how many hold the first words of the passage. Run it after a change to
// `src/lib/parallel-links.ts`, and when a work is added:  bun scripts/check-parallel-links.ts
// It asks the live API for the passages. A Bible address is built by this checkout; the address of
// another work is the one that the API serves, which holds the stored anchor of the passage.
import { bibleUrl, scriptureUrl } from "../src/lib/parallel-links.ts";

const API = process.env.API_BASE_URL ?? "https://api.urantia.dev";
const REFS = (
	process.env.REFS ??
	"1:0.3,2:5.1,3:1.4,5:1.6,12:4.3,34:6.11,48:6.33,74:6.3,100:4.3,111:4.5,121:8.3,131:3.2,131:8.3,140:5.7,159:5.2,170:2.6,195:9.3,196:0.5"
).split(",");
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
	const res = await fetch(`${API}/paragraphs/${ref}?include=bibleParallels,scriptureParallels`, {
		headers: AGENT,
	});
	if (!res.ok) throw new Error(`${ref}: the API answered ${res.status}`);
	const data = (
		(await res.json()) as { data: { bibleParallels?: any[]; scriptureParallels?: any[] } }
	).data;
	for (const b of data.bibleParallels ?? [])
		passages.push({
			work: "bible",
			reference: b.reference,
			text: b.text,
			url: bibleUrl(b.bookCode, b.chapter, b.verseStart),
		});
	for (const s of data.scriptureParallels ?? [])
		passages.push({
			work: s.corpus.id,
			reference: s.reference,
			text: s.text,
			// The API has the stored anchor of the passage. This checkout builds the address without it.
			url: s.url ?? scriptureUrl(s.corpus.id, s.reference, s.text),
		});
}

type Count = {
	all: number;
	noUrl: number;
	noPage: number;
	plain: number;
	one: number;
	none: number;
	many: number;
	notes: string[];
};
const results = new Map<string, Count>();
const seen = new Set<string>();
for (const p of passages) {
	const key = `${p.work} ${p.reference}`;
	if (seen.has(key)) continue;
	seen.add(key);
	const r = results.get(p.work) ?? {
		all: 0,
		noUrl: 0,
		noPage: 0,
		plain: 0,
		one: 0,
		none: 0,
		many: 0,
		notes: [],
	};
	results.set(p.work, r);
	r.all += 1;
	if (!p.url) {
		r.noUrl += 1;
		continue;
	}
	const text = await page(p.url);
	if (text === null) {
		r.noPage += 1;
		r.notes.push(`${p.reference}: no page at ${p.url.split("#")[0]}`);
		continue;
	}
	const fragment = p.url.split("#:~:text=")[1];
	if (fragment === undefined) {
		r.plain += 1;
		continue;
	}
	// A browser goes to the first place that has the words. More than one place means that it can mark
	// another passage, and that is a wrong link.
	const words = same(decodeURIComponent(fragment));
	const places = text.split(words).length - 1;
	if (places === 1) r.one += 1;
	else if (places === 0) {
		r.none += 1;
		r.notes.push(`${p.reference}: not on the page: "${words}"`);
	} else {
		r.many += 1;
		r.notes.push(`${p.reference}: ${places} places: "${words}"`);
	}
}

let bad = false;
for (const [work, r] of results) {
	console.log(
		`${work}: ${r.all} passages | no address ${r.noUrl} | no page ${r.noPage} | page or verse only ${r.plain} | words in one place ${r.one} | words not found ${r.none} | words in more places ${r.many}`,
	);
	for (const line of r.notes.slice(0, Number(process.env.NOTES ?? 6))) console.log(`    ${line}`);
	if (r.noPage > 0 || r.many > 0) bad = true;
}
// A page that does not open, or words that are in more than one place, is a wrong link. Words that are
// not on the page cost only the scroll to the passage: the page opens at its top.
process.exit(bad ? 1 : 0);
