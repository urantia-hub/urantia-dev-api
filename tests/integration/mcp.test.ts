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

describe("MCP Server", () => {
	it("returns discovery response for GET /mcp", async () => {
		const res = await app.request("/mcp", { method: "GET" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.server.name).toBe("Urantia Papers API");
		expect(Object.keys(body.capabilities.tools).length).toBe(13);
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

	it("lists all 13 tools", async () => {
		// Initialize first
		await mcpRequest({
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			},
		});

		const res = await mcpRequest({
			id: 2,
			method: "tools/list",
		});
		expect(res.status).toBe(200);
		const results = await parseMcpResponse(res);
		expect(results.length).toBeGreaterThan(0);
		const tools = results[0].result.tools;
		expect(tools.length).toBe(13);

		const toolNames = tools.map((t: { name: string }) => t.name).sort();
		expect(toolNames).toEqual([
			"get_audio",
			"get_entity",
			"get_entity_paragraphs",
			"get_paper",
			"get_paper_sections",
			"get_paragraph",
			"get_paragraph_context",
			"get_random_paragraph",
			"get_table_of_contents",
			"list_entities",
			"list_papers",
			"search",
			"semantic_search",
		]);
	});

	it("get_table_of_contents returns parts with papers", async () => {
		const results = await callTool("get_table_of_contents");
		expect(results.length).toBeGreaterThan(0);
		const content = JSON.parse(results[0].result.content[0].text);
		expect(content.parts).toBeArray();
		expect(content.parts.length).toBeGreaterThan(0);
		expect(content.parts[0]).toHaveProperty("title");
		expect(content.parts[0].papers).toBeArray();
	});

	it("get_paragraph returns a paragraph by ref", async () => {
		const results = await callTool("get_paragraph", { ref: "0.0.1" });
		expect(results.length).toBeGreaterThan(0);
		const content = JSON.parse(results[0].result.content[0].text);
		expect(content).toHaveProperty("text");
		expect(content).toHaveProperty("standardReferenceId");
	});

	it("get_paragraph returns error for invalid ref", async () => {
		const results = await callTool("get_paragraph", { ref: "invalid" });
		expect(results.length).toBeGreaterThan(0);
		const result = results[0].result;
		expect(result.isError).toBe(true);
		const content = JSON.parse(result.content[0].text);
		expect(content.error).toContain("Invalid reference format");
	});

	it("search returns results for a query", async () => {
		const results = await callTool("search", { q: "God", limit: 3 });
		expect(results.length).toBeGreaterThan(0);
		const content = JSON.parse(results[0].result.content[0].text);
		expect(content.data).toBeArray();
		expect(content.data.length).toBeGreaterThan(0);
		expect(content.meta).toHaveProperty("total");
	});

	it("list_entities returns paginated results", async () => {
		const results = await callTool("list_entities", { limit: 5 });
		expect(results.length).toBeGreaterThan(0);
		const content = JSON.parse(results[0].result.content[0].text);
		expect(content.data).toBeArray();
		expect(content.meta).toHaveProperty("total");
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
		// Should contain at least one bracketed paragraph reference
		expect(contents[0].text).toMatch(/\[1:\d+\.\d+\]/);
	});

	it("reads urantia://entity/{id} as markdown when entity exists", async () => {
		// Use list_entities to find a real entity id, then fetch the resource
		const listResults = await callTool("list_entities", { limit: 1 });
		const list = JSON.parse(listResults[0].result.content[0].text);
		const entityId = list.data[0]?.id;
		if (!entityId) return; // skip if no entities seeded
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
