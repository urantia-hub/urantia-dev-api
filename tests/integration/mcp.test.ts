import { describe, expect, it } from "bun:test";
import { app } from "../../src/index.ts";

function mcpRequest(body: unknown) {
	return app.request("/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			...body,
		}),
	});
}

async function parseMcpResponse(res: Response) {
	const text = await res.text();
	// SSE format: lines starting with "data: " contain JSON
	const lines = text.split("\n").filter((l) => l.startsWith("data: "));
	const results = lines.map((l) => JSON.parse(l.slice(6)));
	return results;
}

async function initialize() {
	const initRes = await mcpRequest({
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "test", version: "1.0.0" },
		},
	});
	const initResults = await parseMcpResponse(initRes);
	expect(initResults.length).toBeGreaterThan(0);
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
	await initialize();
	const toolRes = await mcpRequest({
		id: 2,
		method: "tools/call",
		params: { name, arguments: args },
	});
	return parseMcpResponse(toolRes);
}

async function readResource(uri: string) {
	await initialize();
	const res = await mcpRequest({
		id: 2,
		method: "resources/read",
		params: { uri },
	});
	return parseMcpResponse(res);
}

async function getPrompt(name: string, args: Record<string, unknown> = {}) {
	await initialize();
	const res = await mcpRequest({
		id: 2,
		method: "prompts/get",
		params: { name, arguments: args },
	});
	return parseMcpResponse(res);
}

const EXPECTED_TOOL_NAMES = [
	"audio.get",
	"bible.book",
	"bible.books",
	"bible.chapter",
	"bible.search.semantic",
	"bible.verse",
	"bible.verse.urantia_parallels",
	"entities.get",
	"entities.list",
	"entities.paragraphs",
	"papers.get",
	"papers.list",
	"papers.sections",
	"paragraphs.context",
	"paragraphs.get",
	"paragraphs.random",
	"search.fulltext",
	"search.semantic",
	"toc.get",
];

describe("MCP Server", () => {
	it("returns discovery response for GET /mcp", async () => {
		const res = await app.request("/mcp", { method: "GET" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.server.name).toBe("Urantia Papers API");
		const toolKeys = Object.keys(body.capabilities.tools).sort();
		expect(toolKeys).toEqual(EXPECTED_TOOL_NAMES);
		expect(Object.keys(body.capabilities.resources)).toEqual([
			"urantia://paper/{id}",
			"urantia://entity/{id}",
		]);
		expect(Object.keys(body.capabilities.prompts).sort()).toEqual([
			"comparative_theology",
			"study_assistant",
		]);
		expect(body.usage.config.mcpServers["urantia-papers"].url).toBe("https://api.urantia.dev/mcp");
	});

	it("handles initialize request", async () => {
		const res = await mcpRequest({
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			},
		});
		expect(res.status).toBe(200);
		const results = await parseMcpResponse(res);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].result.serverInfo.name).toBe("Urantia Papers API");
	});

	it("lists all 19 tools with dot-notation names", async () => {
		await initialize();
		const res = await mcpRequest({ id: 2, method: "tools/list" });
		expect(res.status).toBe(200);
		const results = await parseMcpResponse(res);
		expect(results.length).toBeGreaterThan(0);
		const tools = results[0].result.tools;
		expect(tools.length).toBe(19);

		const toolNames = tools.map((t: { name: string }) => t.name).sort();
		expect(toolNames).toEqual(EXPECTED_TOOL_NAMES);
	});

	it("tools advertise read-only annotations", async () => {
		await initialize();
		const res = await mcpRequest({ id: 2, method: "tools/list" });
		const results = await parseMcpResponse(res);
		const tools = results[0].result.tools;
		for (const tool of tools) {
			expect(tool.annotations?.readOnlyHint).toBe(true);
			expect(tool.annotations?.destructiveHint).toBe(false);
		}
	});

	it("tools advertise output schemas", async () => {
		await initialize();
		const res = await mcpRequest({ id: 2, method: "tools/list" });
		const results = await parseMcpResponse(res);
		const tools = results[0].result.tools;
		for (const tool of tools) {
			expect(tool.outputSchema).toBeDefined();
			expect(tool.outputSchema.type).toBe("object");
		}
	});

	it("toc.get returns parts with papers via structuredContent", async () => {
		const results = await callTool("toc.get");
		expect(results.length).toBeGreaterThan(0);
		const result = results[0].result;
		expect(result.structuredContent).toBeDefined();
		expect(result.structuredContent.parts).toBeArray();
		expect(result.structuredContent.parts[0]).toHaveProperty("title");
		expect(result.structuredContent.parts[0].papers).toBeArray();
	});

	it("paragraphs.get returns a paragraph wrapped under .paragraph", async () => {
		const results = await callTool("paragraphs.get", { ref: "0.0.1" });
		expect(results.length).toBeGreaterThan(0);
		const { structuredContent } = results[0].result;
		expect(structuredContent.paragraph).toBeDefined();
		expect(structuredContent.paragraph.text).toBeDefined();
		expect(structuredContent.paragraph.standardReferenceId).toBeDefined();
	});

	it("paragraphs.get returns error for invalid ref", async () => {
		const results = await callTool("paragraphs.get", { ref: "invalid" });
		expect(results.length).toBeGreaterThan(0);
		const result = results[0].result;
		expect(result.isError).toBe(true);
		const content = JSON.parse(result.content[0].text);
		expect(content.error).toContain("Invalid reference format");
	});

	it("search.fulltext returns results when query passed as `q`", async () => {
		const results = await callTool("search.fulltext", { q: "God", limit: 3 });
		expect(results.length).toBeGreaterThan(0);
		const { structuredContent } = results[0].result;
		expect(structuredContent.data).toBeArray();
		expect(structuredContent.data.length).toBeGreaterThan(0);
		expect(structuredContent.meta).toHaveProperty("total");
	});

	it("search.fulltext returns results when query passed as `query`", async () => {
		const results = await callTool("search.fulltext", { query: "God", limit: 3 });
		expect(results.length).toBeGreaterThan(0);
		const { structuredContent } = results[0].result;
		expect(structuredContent.data).toBeArray();
		expect(structuredContent.data.length).toBeGreaterThan(0);
	});

	it("search.fulltext errors when neither `query` nor `q` is provided", async () => {
		const results = await callTool("search.fulltext", { limit: 3 });
		expect(results.length).toBeGreaterThan(0);
		const result = results[0].result;
		expect(result.isError).toBe(true);
		const err = JSON.parse(result.content[0].text);
		expect(err.error).toContain("query");
	});

	it("search.semantic accepts `query` as well as `q`", async () => {
		const results = await callTool("search.semantic", {
			query: "what happens after death",
			limit: 2,
		});
		expect(results.length).toBeGreaterThan(0);
		const { structuredContent } = results[0].result;
		expect(structuredContent.data).toBeArray();
	});

	it("entities.list returns paginated results", async () => {
		const results = await callTool("entities.list", { limit: 5 });
		expect(results.length).toBeGreaterThan(0);
		const { structuredContent } = results[0].result;
		expect(structuredContent.data).toBeArray();
		expect(structuredContent.meta).toHaveProperty("total");
	});

	it("entities.list filters by `q` (legacy alias)", async () => {
		const results = await callTool("entities.list", { q: "Adjuster", limit: 3 });
		const { structuredContent } = results[0].result;
		expect(structuredContent.data).toBeArray();
	});

	it("entities.list filters by `query`", async () => {
		const results = await callTool("entities.list", { query: "Adjuster", limit: 3 });
		const { structuredContent } = results[0].result;
		expect(structuredContent.data).toBeArray();
	});

	it("paragraphs.random advertises non-idempotent annotation", async () => {
		await initialize();
		const res = await mcpRequest({ id: 2, method: "tools/list" });
		const results = await parseMcpResponse(res);
		const tools = results[0].result.tools;
		const random = tools.find((t: { name: string }) => t.name === "paragraphs.random");
		expect(random.annotations.idempotentHint).toBe(false);
	});

	it("search.semantic advertises openWorld annotation", async () => {
		await initialize();
		const res = await mcpRequest({ id: 2, method: "tools/list" });
		const results = await parseMcpResponse(res);
		const tools = results[0].result.tools;
		const semantic = tools.find((t: { name: string }) => t.name === "search.semantic");
		expect(semantic.annotations.openWorldHint).toBe(true);
	});

	it("paragraphs.get accepts include_bible_parallels and include_urantia_parallels", async () => {
		await initialize();
		const res = await mcpRequest({ id: 2, method: "tools/list" });
		const results = await parseMcpResponse(res);
		const tools = results[0].result.tools;
		const get = tools.find((t: { name: string }) => t.name === "paragraphs.get");
		expect(get.inputSchema.properties).toHaveProperty("include_bible_parallels");
		expect(get.inputSchema.properties).toHaveProperty("include_urantia_parallels");
	});

	it("search.fulltext and search.semantic advertise the parallels include params", async () => {
		await initialize();
		const res = await mcpRequest({ id: 2, method: "tools/list" });
		const results = await parseMcpResponse(res);
		const tools = results[0].result.tools;
		for (const name of ["search.fulltext", "search.semantic"]) {
			const tool = tools.find((t: { name: string }) => t.name === name);
			expect(tool.inputSchema.properties).toHaveProperty("include_bible_parallels");
			expect(tool.inputSchema.properties).toHaveProperty("include_urantia_parallels");
		}
	});

	it("bible.books returns all 81 books with canon and counts", async () => {
		const results = await callTool("bible.books");
		const { structuredContent } = results[0].result;
		expect(structuredContent.books).toBeArray();
		expect(structuredContent.books.length).toBe(81);
		const first = structuredContent.books[0];
		expect(first).toHaveProperty("bookCode");
		expect(first).toHaveProperty("canon");
		expect(first).toHaveProperty("chapterCount");
		expect(first).toHaveProperty("verseCount");
	});

	it("bible.book accepts OSIS, USFM, and full-name aliases", async () => {
		for (const code of ["Gen", "GEN", "Genesis", "genesis"]) {
			const results = await callTool("bible.book", { book_code: code });
			const result = results[0].result;
			if (result.isError) {
				throw new Error(`bible.book failed for "${code}": ${result.content[0].text}`);
			}
			expect(result.structuredContent.book.bookCode).toBe("Gen");
		}
	});

	it("bible.book errors for unknown book", async () => {
		const results = await callTool("bible.book", { book_code: "Zorblax" });
		expect(results[0].result.isError).toBe(true);
	});

	it("bible.chapter returns ordered verses", async () => {
		const results = await callTool("bible.chapter", { book_code: "Gen", chapter: 1 });
		const { structuredContent } = results[0].result;
		expect(structuredContent.bookCode).toBe("Gen");
		expect(structuredContent.chapter).toBe(1);
		expect(structuredContent.verses).toBeArray();
		expect(structuredContent.verses.length).toBeGreaterThan(0);
		expect(structuredContent.verses[0].verse).toBe(1);
	});

	it("bible.verse returns a single verse", async () => {
		const results = await callTool("bible.verse", {
			book_code: "John",
			chapter: 11,
			verse: 35,
		});
		const { structuredContent } = results[0].result;
		expect(structuredContent.verse).toBeDefined();
		expect(structuredContent.verse.bookCode).toBe("John");
		expect(structuredContent.verse.text).toBeTruthy();
	});

	it("bible.verse.urantia_parallels returns top-10 UB paragraphs for a Bible verse", async () => {
		const results = await callTool("bible.verse.urantia_parallels", {
			book_code: "Matt",
			chapter: 5,
			verse: 3,
		});
		const result = results[0].result;
		// Skip if Bible parallels aren't seeded in this test env
		if (result.isError) return;
		const sc = result.structuredContent;
		expect(sc.verse.bookCode).toBe("Matt");
		expect(sc.chunk).toBeDefined();
		expect(sc.urantiaParallels).toBeArray();
	});

	it("bible.search.semantic accepts canon and book_code filters", async () => {
		await initialize();
		const res = await mcpRequest({ id: 2, method: "tools/list" });
		const tools = (await parseMcpResponse(res))[0].result.tools;
		const sem = tools.find((t: { name: string }) => t.name === "bible.search.semantic");
		expect(sem.inputSchema.properties).toHaveProperty("canon");
		expect(sem.inputSchema.properties).toHaveProperty("book_code");
		expect(sem.inputSchema.properties).toHaveProperty("urantia_parallel_limit");
		expect(sem.annotations.openWorldHint).toBe(true);
	});
});

describe("MCP Resources", () => {
	it("lists resource templates", async () => {
		await initialize();
		const res = await mcpRequest({
			id: 2,
			method: "resources/templates/list",
		});
		const results = await parseMcpResponse(res);
		expect(results.length).toBeGreaterThan(0);
		const templates = results[0].result.resourceTemplates;
		expect(templates).toBeArray();
		const uris = templates.map((t: { uriTemplate: string }) => t.uriTemplate).sort();
		expect(uris).toEqual(["urantia://entity/{id}", "urantia://paper/{id}"]);
	});

	it("reads urantia://paper/1 as markdown", async () => {
		const results = await readResource("urantia://paper/1");
		expect(results.length).toBeGreaterThan(0);
		const contents = results[0].result.contents;
		expect(contents).toBeArray();
		expect(contents[0].mimeType).toBe("text/markdown");
		expect(contents[0].text).toStartWith("# Paper 1:");
		expect(contents[0].text).toMatch(/\[1:\d+\.\d+\]/);
	});

	it("reads urantia://entity/{id} as markdown when entity exists", async () => {
		const listResults = await callTool("entities.list", { limit: 1 });
		const list = listResults[0].result.structuredContent;
		const entityId = list.data[0]?.id;
		if (!entityId) return;
		const results = await readResource(`urantia://entity/${entityId}`);
		expect(results.length).toBeGreaterThan(0);
		const contents = results[0].result.contents;
		expect(contents[0].mimeType).toBe("text/markdown");
		expect(contents[0].text).toContain("**Type:**");
	});
});

describe("MCP Prompts", () => {
	it("lists prompts", async () => {
		await initialize();
		const res = await mcpRequest({
			id: 2,
			method: "prompts/list",
		});
		const results = await parseMcpResponse(res);
		const prompts = results[0].result.prompts;
		const names = prompts.map((p: { name: string }) => p.name).sort();
		expect(names).toEqual(["comparative_theology", "study_assistant"]);
	});

	it("study_assistant returns a primer message", async () => {
		const results = await getPrompt("study_assistant");
		const messages = results[0].result.messages;
		expect(messages).toBeArray();
		expect(messages[0].role).toBe("user");
		expect(messages[0].content.text).toContain("study assistant");
	});

	it("study_assistant interpolates the topic argument", async () => {
		const results = await getPrompt("study_assistant", { topic: "the nature of God" });
		const text = results[0].result.messages[0].content.text;
		expect(text).toContain("the nature of God");
	});

	it("comparative_theology requires topic and tradition", async () => {
		const results = await getPrompt("comparative_theology", {
			topic: "the soul",
			tradition: "Buddhism",
		});
		const text = results[0].result.messages[0].content.text;
		expect(text).toContain("the soul");
		expect(text).toContain("Buddhism");
	});
});
