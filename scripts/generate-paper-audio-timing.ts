// Writes data/paper-audio-timing.json: where each title, paragraph, and sentence starts in the full
// audio file of each paper. It reads the public API and the CDN. No database.
// Needs ffmpeg, and a Python with faster-whisper (HEAR_PYTHON, default python3): a speech model checks each start.
// Usage: bun scripts/generate-paper-audio-timing.ts [paperId ...]
// With paper ids, it changes only those papers in the existing file and report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Item,
	leadIn,
	type Pause,
	place,
	placeSentences,
	sentences,
	titleLength,
} from "./audio-timing/place";
import { earTimes, repair } from "./audio-timing/verify";

const API = "https://api.urantia.dev";
const CDN = "https://cdn.urantia.dev/audio/eng/papers";
const CACHE = process.env.PAPER_AUDIO_DIR ?? join(import.meta.dir, "../.cache/paper-audio");
const OUTPUT_PATH = join(import.meta.dir, "../data/paper-audio-timing.json");
const REPORT_PATH = join(import.meta.dir, "../data/paper-audio-timing-report.txt");
const PUBLISH_PATH = join(
	import.meta.dir,
	"../../urantia-data-sources/data/manifests/paper-audio-timing.json",
);

const HEAR = join(import.meta.dir, "audio-timing/hear.py");
// Starts that a person checked by ear, for items the speech model cannot confirm: paper id to key to time.
const BY_EAR: Record<string, Record<string, number>> = JSON.parse(
	readFileSync(join(import.meta.dir, "audio-timing/by-ear.json"), "utf-8"),
);
// The maps of the papers that fail, with the missed keys, for a check by ear.
const UNCONFIRMED_PATH = join(import.meta.dir, "../data/paper-audio-timing-unconfirmed.json");

type Paragraph = {
	standardReferenceId: string;
	sectionId: string;
	sectionTitle: string | null;
	text: string;
	audio: { "tts-1-hd"?: { nova?: { duration: number } } } | null;
};

async function run(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	return out + err;
}

async function pauses(path: string, shortest: number): Promise<Pause[]> {
	const out = await run([
		"ffmpeg",
		"-hide_banner",
		"-i",
		path,
		"-af",
		`silencedetect=noise=-35dB:d=${shortest}`,
		"-f",
		"null",
		"-",
	]);
	const starts = [...out.matchAll(/silence_start: ([0-9.]+)/g)].map((m) => Number(m[1]));
	const ends = [...out.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1]));
	return starts.slice(0, ends.length).map((start, i) => ({ start, end: ends[i] ?? start }));
}

async function duration(path: string): Promise<number> {
	return Number(
		(
			await run([
				"ffprobe",
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"csv=p=0",
				path,
			])
		).trim(),
	);
}

// One speech model process for the whole run: a JSON line in, a JSON line out.
const hearer = Bun.spawn([process.env.HEAR_PYTHON ?? "python3", "-I", HEAR], {
	stdin: "pipe",
	stdout: "pipe",
	stderr: "inherit",
});
const lines = (async function* () {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of hearer.stdout) {
		buffer += decoder.decode(chunk);
		let n = buffer.indexOf("\n");
		while (n !== -1) {
			yield buffer.slice(0, n);
			buffer = buffer.slice(n + 1);
			n = buffer.indexOf("\n");
		}
	}
})();

// The words in the seconds after each time, or with `before`, in the seconds before it.
async function hear(path: string, ats: number[], before = false): Promise<string[]> {
	hearer.stdin.write(`${JSON.stringify({ path, ats, before })}\n`);
	hearer.stdin.flush();
	const { value, done } = await lines.next();
	if (done) throw new Error("the speech model stopped");
	return JSON.parse(value) as string[];
}

async function paper(id: string) {
	const res = await fetch(`${API}/papers/${id}`, {
		headers: { "user-agent": "urantia-dev-api/paper-audio-timing" },
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) throw new Error(`paper ${id}: API ${res.status}`);
	const { data } = (await res.json()) as {
		data: { paper: { title: string }; paragraphs: Paragraph[] };
	};
	return data;
}

// A stalled download once held the whole run for hours: each try has a time limit.
async function download(url: string, path: string) {
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
			if (!res.ok) throw new Error(`CDN ${res.status}`);
			await Bun.write(path, await res.arrayBuffer());
			return;
		} catch (error) {
			if (attempt === 3) throw new Error(`${url}: ${(error as Error).message}`);
		}
	}
}

async function one(id: string) {
	const url = `${CDN}/${id}.mp3`;
	const path = join(CACHE, `${id}.mp3`);
	if (!existsSync(path)) await download(url, path);
	const data = await paper(id);
	const items: Item[] = [
		{
			kind: "title",
			key: "title",
			expect: titleLength(data.paper.title, "title"),
			text: data.paper.title,
		},
	];
	const texts = new Map<string, string>();
	let section: string | null = null;
	for (const p of data.paragraphs) {
		if (p.sectionId !== section) {
			section = p.sectionId;
			// Section 0 has no title, and the voice reads none.
			if (p.sectionTitle && p.sectionId !== "0")
				items.push({
					kind: "section",
					key: `section:${p.sectionId}`,
					expect: titleLength(p.sectionTitle, "section"),
					text: p.sectionTitle,
				});
		}
		const length = p.audio?.["tts-1-hd"]?.nova?.duration;
		if (!length) throw new Error(`paper ${id}: ${p.standardReferenceId} has no audio length`);
		items.push({ kind: "para", key: p.standardReferenceId, expect: length, text: p.text });
		texts.set(p.standardReferenceId, p.text);
	}
	// The placement uses the clear pauses. The repair can also start at a short one, as between two list items.
	const [gaps, short, total] = await Promise.all([
		pauses(path, 0.2),
		pauses(path, 0.08),
		duration(path),
	]);
	const placed = place(items, gaps, total);
	if (!placed) return { id, ok: false as const, why: "no placement", items: items.length };
	// The gate: the speech model hears the right words at every start, after the repair.
	const heard = await repair(
		items.map((item) => item.text ?? ""),
		placed.starts.map((s) => s.at),
		short,
		(ats, before) => hear(path, ats, before),
		20,
		earTimes(
			items.map((item) => item.key),
			BY_EAR[id] ?? {},
		),
	);
	const ok = heard.missed.length === 0;
	let withSentences = 0;
	let last = Number.NEGATIVE_INFINITY;
	const starts = placed.starts.map((s, i) => {
		const at = heard.at[i] ?? s.at;
		const next = heard.at[i + 1];
		// The item ends where the pause before the next item starts.
		const to = next === undefined ? total : (short.find((g) => g.end === next)?.start ?? next);
		const text = texts.get(s.key);
		const parts = text ? placeSentences(sentences(text), at, to, gaps) : null;
		const from = leadIn(at, short, last);
		last = from;
		if (!parts) return { key: s.key, at: from };
		withSentences++;
		return { key: s.key, at: from, sentences: [from, ...parts.slice(1)] };
	});
	return {
		id,
		ok,
		missedKeys: heard.missed.map((i) => items[i]?.key ?? ""),
		worst: placed.worst,
		offset: placed.offset,
		moved: heard.moved,
		// Each missed item with the words heard at its start, for the report.
		missed: (
			await hear(
				path,
				heard.missed.map((i) => heard.at[i] ?? 0),
			)
		).map((said, n) => `${items[heard.missed[n] ?? 0]?.key} "${said}"`),
		items: items.length,
		withSentences,
		paras: texts.size,
		value: { url, format: "mp3", bitrate: 32, duration: Math.round(total * 100) / 100, starts },
	};
}

mkdirSync(CACHE, { recursive: true });
const some = process.argv.slice(2);
const ids = some.length ? some : Array.from({ length: 197 }, (_, i) => String(i));
const keep = some.length && existsSync(OUTPUT_PATH);
const out: Record<string, unknown> = keep ? JSON.parse(readFileSync(OUTPUT_PATH, "utf-8")) : {};
const unconfirmed: Record<string, unknown> =
	keep && existsSync(UNCONFIRMED_PATH) ? JSON.parse(readFileSync(UNCONFIRMED_PATH, "utf-8")) : {};
const report: string[] =
	keep && existsSync(REPORT_PATH)
		? readFileSync(REPORT_PATH, "utf-8")
				.split("\n")
				.filter((line) => line && !ids.some((id) => line.startsWith(`paper ${id}:`)))
		: [];
for (const id of ids) {
	delete out[id];
	delete unconfirmed[id];
	try {
		const r = await one(id);
		if (r.ok && "value" in r) out[id] = { "tts-1-hd": { nova: r.value } };
		if (!r.ok && "value" in r) unconfirmed[id] = { missed: r.missedKeys, nova: r.value };
		const line =
			"value" in r
				? `paper ${id}: ${r.ok ? "PASS" : `FAIL missed ${(r.missed ?? []).slice(0, 5).join(" | ")}`} moved ${r.moved} worst ${r.worst}s offset ${r.offset}s items ${r.items} sentences ${r.withSentences}/${r.paras}`
				: `paper ${id}: FAIL ${r.why}`;
		report.push(line);
		console.log(line);
	} catch (error) {
		report.push(`paper ${id}: ERROR ${(error as Error).message}`);
		console.log(report[report.length - 1]);
	}
}
writeFileSync(OUTPUT_PATH, JSON.stringify(out));
writeFileSync(UNCONFIRMED_PATH, JSON.stringify(unconfirmed));
const order = (line: string) => Number(line.match(/^paper (\d+):/)?.[1] ?? 999);
writeFileSync(REPORT_PATH, `${report.sort((a, b) => order(a) - order(b)).join("\n")}\n`);
if (existsSync(join(PUBLISH_PATH, ".."))) writeFileSync(PUBLISH_PATH, JSON.stringify(out));
console.log(`${Object.keys(out).length} papers have a map. ${OUTPUT_PATH}`);
hearer.kill();
