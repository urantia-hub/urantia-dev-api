import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { app } from "../../src/index.ts";

// The full audio file of a paper and its time map: only GET /papers/{id} carries it.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const PART = "t9";
const MAPPED = "t99";
const PLAIN = "t98";
const AUDIO = {
	"tts-1-hd": {
		nova: {
			url: "https://cdn.urantia.dev/audio/eng/papers/99.mp3",
			format: "mp3",
			bitrate: 32,
			duration: 1450.5,
			starts: [
				{ key: "title", at: 0 },
				{ key: "99:0.1", at: 4.1, sentences: [4.1, 9.8] },
				{ key: "section:1", at: 31.2 },
			],
		},
	},
};

suite("the audio of a whole paper", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });
	const saved = process.env.DATABASE_URL;

	beforeAll(async () => {
		process.env.DATABASE_URL = url;
		await db.insert(schema.parts).values({ id: PART, title: "Test part", sortId: "9" });
		await db.insert(schema.papers).values([
			{ id: MAPPED, partId: PART, title: "Mapped", globalId: "t:99", sortId: "t099", audio: AUDIO },
			{ id: PLAIN, partId: PART, title: "Plain", globalId: "t:98", sortId: "t098" },
		]);
	});

	afterAll(async () => {
		await db.delete(schema.papers).where(inArray(schema.papers.id, [MAPPED, PLAIN]));
		await db.delete(schema.parts).where(inArray(schema.parts.id, [PART]));
		await client.end();
		// Each request opens its own client (getDb), which closes after 2 idle seconds. The next file
		// needs those connections: the database allows 100.
		await Bun.sleep(2500);
		if (saved === undefined) delete process.env.DATABASE_URL;
		else process.env.DATABASE_URL = saved;
	});

	it("GET /papers/{id} carries the time map, title first", async () => {
		const res = await app.request(`/papers/${MAPPED}`);
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.paper.audio).toEqual(AUDIO);
		expect(data.paper.audio["tts-1-hd"].nova.starts[0]).toEqual({ key: "title", at: 0 });
	});

	it("a paper with no map answers audio: null", async () => {
		const res = await app.request(`/papers/${PLAIN}`);
		const { data } = await res.json();
		expect(data.paper.audio).toBeNull();
	});

	it("the MCP tool papers.get gives the file and its length, not the starts", async () => {
		const res = await app.request("/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "papers.get", arguments: { paper_id: MAPPED } },
			}),
		});
		const line = (await res.text()).split("\n").find((l) => l.startsWith("data: ")) ?? "";
		const { result } = JSON.parse(line.slice(6));
		expect(result.structuredContent.paper.audio).toEqual({
			url: AUDIO["tts-1-hd"].nova.url,
			duration: AUDIO["tts-1-hd"].nova.duration,
		});
	});

	it("the list and the table of contents leave the map out", async () => {
		const list = await (await app.request("/papers")).json();
		const listed = list.data.find((p: { id: string }) => p.id === MAPPED);
		expect(listed).toBeDefined();
		expect("audio" in listed).toBe(false);

		const toc = await (await app.request("/toc")).json();
		const part = toc.data.parts.find((p: { id: string }) => p.id === PART);
		expect(Object.keys(part.papers[0]).sort()).toEqual(["id", "labels", "title"]);
	});
});
