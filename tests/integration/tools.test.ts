import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";

const EXPECTED_TOOL_NAMES = [
	"bible_semantic_search",
	"get_audio",
	"get_bible_book",
	"get_bible_chapter",
	"get_bible_verse",
	"get_bible_verse_urantia_parallels",
	"get_entity",
	"get_entity_paragraphs",
	"get_paper",
	"get_paper_sections",
	"get_paragraph",
	"get_paragraph_context",
	"get_random_paragraph",
	"get_table_of_contents",
	"list_bible_books",
	"list_entities",
	"list_papers",
	"search",
	"semantic_search",
];

describe("GET /tools/openai", () => {
	it("returns 200 with OpenAI-shaped tools", async () => {
		const res = await get("/tools/openai");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.server.name).toBe("Urantia Papers API");
		expect(body.server.base_url).toBe("https://api.urantia.dev");
		expect(body.tools).toBeArray();
		expect(body.tools.length).toBe(19);
	});

	it("each tool has the OpenAI function envelope", async () => {
		const res = await get("/tools/openai");
		const { tools } = await res.json();
		for (const tool of tools) {
			expect(tool.type).toBe("function");
			expect(tool.function).toHaveProperty("name");
			expect(tool.function).toHaveProperty("description");
			expect(tool.function).toHaveProperty("parameters");
			expect(tool.function.parameters.type).toBe("object");
		}
	});

	it("exposes all 19 expected tool names", async () => {
		const res = await get("/tools/openai");
		const { tools } = await res.json();
		const names = tools.map((t: { function: { name: string } }) => t.function.name).sort();
		expect(names).toEqual(EXPECTED_TOOL_NAMES);
	});

	it("required fields are present on tools that need them", async () => {
		const res = await get("/tools/openai");
		const { tools } = await res.json();
		const getParagraph = tools.find(
			(t: { function: { name: string } }) => t.function.name === "get_paragraph",
		);
		expect(getParagraph.function.parameters.required).toEqual(["ref"]);
	});

	it("search tool exposes both `query` and `q` parameters", async () => {
		const res = await get("/tools/openai");
		const { tools } = await res.json();
		const search = tools.find((t: { function: { name: string } }) => t.function.name === "search");
		expect(search.function.parameters.properties).toHaveProperty("query");
		expect(search.function.parameters.properties).toHaveProperty("q");
	});

	it("semantic_search tool exposes both `query` and `q` parameters", async () => {
		const res = await get("/tools/openai");
		const { tools } = await res.json();
		const semantic = tools.find(
			(t: { function: { name: string } }) => t.function.name === "semantic_search",
		);
		expect(semantic.function.parameters.properties).toHaveProperty("query");
		expect(semantic.function.parameters.properties).toHaveProperty("q");
	});
});

describe("GET /tools/anthropic", () => {
	it("returns 200 with Anthropic-shaped tools", async () => {
		const res = await get("/tools/anthropic");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.server.name).toBe("Urantia Papers API");
		expect(body.tools).toBeArray();
		expect(body.tools.length).toBe(19);
	});

	it("each tool has name, description, input_schema", async () => {
		const res = await get("/tools/anthropic");
		const { tools } = await res.json();
		for (const tool of tools) {
			expect(tool).toHaveProperty("name");
			expect(tool).toHaveProperty("description");
			expect(tool).toHaveProperty("input_schema");
			expect(tool.input_schema.type).toBe("object");
		}
	});

	it("exposes all 19 expected tool names", async () => {
		const res = await get("/tools/anthropic");
		const { tools } = await res.json();
		const names = tools.map((t: { name: string }) => t.name).sort();
		expect(names).toEqual(EXPECTED_TOOL_NAMES);
	});

	it("matches OpenAI tool count and names exactly", async () => {
		const [oaiRes, anthRes] = await Promise.all([get("/tools/openai"), get("/tools/anthropic")]);
		const oai = await oaiRes.json();
		const anth = await anthRes.json();
		const oaiNames = oai.tools.map((t: { function: { name: string } }) => t.function.name).sort();
		const anthNames = anth.tools.map((t: { name: string }) => t.name).sort();
		expect(oaiNames).toEqual(anthNames);
	});
});
