/**
 * Provider-neutral catalog of the API's AI-callable tools.
 *
 * The same 13 tools are exposed via the MCP server (src/routes/mcp.ts) and
 * via /tools/openai and /tools/anthropic for direct use with the OpenAI and
 * Anthropic SDKs. The catalog here is the source of truth for the function-
 * calling schemas; MCP keeps its own zod definitions because it also owns
 * handler implementations.
 */

export interface ToolSpec {
	name: string;
	description: string;
	parameters: JSONSchema;
}

interface JSONSchema {
	type: "object";
	properties: Record<string, JSONSchemaProperty>;
	required?: string[];
	additionalProperties?: false;
}

interface JSONSchemaProperty {
	type: "string" | "number" | "integer" | "boolean";
	description: string;
	enum?: readonly string[];
	default?: string | number | boolean;
	minimum?: number;
	maximum?: number;
}

const includeEntitiesProp: JSONSchemaProperty = {
	type: "boolean",
	description: "Include entity mentions in each paragraph",
	default: false,
};

const refParamProp: JSONSchemaProperty = {
	type: "string",
	description:
		'Paragraph reference. Accepts globalId ("1:2.0.1"), standardReferenceId ("2:0.1"), or paperSectionParagraphId ("2.0.1"). Format auto-detected.',
};

const paperIdProp: JSONSchemaProperty = {
	type: "string",
	description: "Paper ID (0-196). Example: '1'",
};

const pageProp: JSONSchemaProperty = {
	type: "integer",
	description: "Page number (0-indexed)",
	default: 0,
	minimum: 0,
};

const limitProp: JSONSchemaProperty = {
	type: "integer",
	description: "Results per page (1-100)",
	default: 20,
	minimum: 1,
	maximum: 100,
};

export const TOOL_CATALOG: readonly ToolSpec[] = [
	{
		name: "get_table_of_contents",
		description:
			"Get the full table of contents of the Urantia Book. Returns all 4 parts and 197 papers with their titles. Best starting point to understand the book structure.",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "list_papers",
		description:
			"List all 197 papers in the Urantia Book with their metadata (id, title, partId, labels). Use get_table_of_contents for a hierarchical view.",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "get_paper",
		description:
			"Get a single paper with all its paragraphs. Paper IDs range from 0 (Foreword) to 196.",
		parameters: {
			type: "object",
			properties: {
				paper_id: paperIdProp,
				include_entities: includeEntitiesProp,
			},
			required: ["paper_id"],
		},
	},
	{
		name: "get_paper_sections",
		description:
			"Get all sections within a paper, ordered by section number. Useful for understanding paper structure before reading specific sections.",
		parameters: {
			type: "object",
			properties: { paper_id: paperIdProp },
			required: ["paper_id"],
		},
	},
	{
		name: "get_random_paragraph",
		description:
			"Get a random paragraph from the Urantia Book. Great for daily quotes, exploration, or discovering new passages.",
		parameters: {
			type: "object",
			properties: { include_entities: includeEntitiesProp },
		},
	},
	{
		name: "get_paragraph",
		description:
			'Look up a specific paragraph by reference. Supports three formats: globalId ("1:2.0.1"), standardReferenceId ("2:0.1"), or paperSectionParagraphId ("2.0.1"). The format is auto-detected.',
		parameters: {
			type: "object",
			properties: { ref: refParamProp, include_entities: includeEntitiesProp },
			required: ["ref"],
		},
	},
	{
		name: "get_paragraph_context",
		description:
			"Get a paragraph with surrounding context (N paragraphs before and after within the same paper). Useful for understanding passages in context.",
		parameters: {
			type: "object",
			properties: {
				ref: refParamProp,
				window: {
					type: "integer",
					description: "Number of paragraphs before and after (1-10)",
					default: 2,
					minimum: 1,
					maximum: 10,
				},
				include_entities: includeEntitiesProp,
			},
			required: ["ref"],
		},
	},
	{
		name: "search",
		description:
			'Full-text search across all Urantia Book paragraphs. Supports three modes: "and" (all words must appear, default), "or" (any word), "phrase" (exact phrase). Results ranked by relevance.',
		parameters: {
			type: "object",
			properties: {
				q: { type: "string", description: 'Search query. Example: "nature of God"' },
				type: {
					type: "string",
					description: "Search mode",
					enum: ["phrase", "and", "or"],
					default: "and",
				},
				paper_id: { type: "string", description: "Filter to a specific paper ID" },
				part_id: { type: "string", description: "Filter to a specific part ID (1-4)" },
				page: pageProp,
				limit: limitProp,
				include_entities: includeEntitiesProp,
			},
			required: ["q"],
		},
	},
	{
		name: "semantic_search",
		description:
			"Search the Urantia Book using semantic similarity (vector embeddings). Returns conceptually related results even without exact keyword matches.",
		parameters: {
			type: "object",
			properties: {
				q: {
					type: "string",
					description: 'Natural language query. Example: "What is the meaning of life?"',
				},
				paper_id: { type: "string", description: "Filter to a specific paper ID" },
				part_id: { type: "string", description: "Filter to a specific part ID (1-4)" },
				page: pageProp,
				limit: limitProp,
				include_entities: includeEntitiesProp,
			},
			required: ["q"],
		},
	},
	{
		name: "list_entities",
		description:
			"Browse the entity catalog: beings, places, orders, races, religions, and concepts mentioned in the Urantia Book. Supports filtering by type and searching by name.",
		parameters: {
			type: "object",
			properties: {
				type: {
					type: "string",
					description: "Filter by entity type",
					enum: ["being", "place", "order", "race", "religion", "concept"],
				},
				q: { type: "string", description: "Search entities by name or alias" },
				page: pageProp,
				limit: limitProp,
			},
		},
	},
	{
		name: "get_entity",
		description:
			"Get detailed information about a specific entity by its slug ID. Returns name, type, aliases, description, related entities, and citation count.",
		parameters: {
			type: "object",
			properties: {
				entity_id: { type: "string", description: 'Entity slug ID. Example: "god-the-father"' },
			},
			required: ["entity_id"],
		},
	},
	{
		name: "get_entity_paragraphs",
		description:
			"Get all paragraphs that mention a specific entity, ordered by position in the text. Useful for studying everything said about a particular being, place, or concept.",
		parameters: {
			type: "object",
			properties: {
				entity_id: { type: "string", description: 'Entity slug ID. Example: "god-the-father"' },
				page: pageProp,
				limit: limitProp,
			},
			required: ["entity_id"],
		},
	},
	{
		name: "get_audio",
		description:
			"Get the audio file URL for a specific paragraph. Accepts any paragraph reference format.",
		parameters: {
			type: "object",
			properties: {
				paragraph_ref: {
					type: "string",
					description: 'Paragraph reference. Example: "2:0.1"',
				},
			},
			required: ["paragraph_ref"],
		},
	},
] as const;

/**
 * OpenAI Chat Completions / Assistants tool format.
 * https://platform.openai.com/docs/guides/function-calling
 */
export function toOpenAITools() {
	return TOOL_CATALOG.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	}));
}

/**
 * Anthropic Messages tool format.
 * https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */
export function toAnthropicTools() {
	return TOOL_CATALOG.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters,
	}));
}
