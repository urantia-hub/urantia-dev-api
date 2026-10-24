/**
 * Provider-neutral catalog of the API's AI-callable tools.
 *
 * The same 26 tools are exposed via the MCP server (src/routes/mcp.ts) and
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

const includeBibleParallelsProp: JSONSchemaProperty = {
	type: "boolean",
	description:
		"Include the top-10 Bible verses semantically nearest to each paragraph (Urantia → Bible direction). Pre-computed via text-embedding-3-large cosine similarity.",
	default: false,
};

const includeUrantiaParallelsProp: JSONSchemaProperty = {
	type: "boolean",
	description:
		"Include the top-10 most-similar OTHER Urantia paragraphs ('see also') for each paragraph. Pre-computed via text-embedding-3-large cosine similarity.",
	default: false,
};

const langProp: JSONSchemaProperty = {
	type: "string",
	description:
		'Language of the text and titles. "es" gives the Spanish translation (a machine translation, CC0); each paragraph then has `language` and a `translation` label. Default "eng".',
	enum: ["eng", "es"],
	default: "eng",
};

const bookCodeProp: JSONSchemaProperty = {
	type: "string",
	description:
		'Bible book identifier. Accepts OSIS ("Gen"), USFM ("GEN"), full name ("Genesis"), or alias ("1-maccabees", "DanGr"). Case-insensitive; hyphens/underscores tolerated.',
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

const workProp: JSONSchemaProperty = {
	type: "string",
	description: 'One work: "bible" or a work id from list_works, such as "dhammapada".',
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

const workQueryProps: Record<string, JSONSchemaProperty> = {
	query: { type: "string", description: 'Search query. Example: "love your enemies"' },
	q: { type: "string", description: "Alias for `query` (REST compatibility)." },
	work: workProp,
	page: pageProp,
	limit: limitProp,
	urantia_parallel_limit: {
		type: "integer",
		description: "How many Urantia paragraphs to attach to each result (0-10).",
		default: 3,
		minimum: 0,
		maximum: 10,
	},
};

const workRefProps: Record<string, JSONSchemaProperty> = {
	work: workProp,
	ref: {
		type: "string",
		description: 'A unit, a short range, or a chapter: "John 3:16", "2.47", "Dhp 183", "John 3".',
	},
};

export const TOOL_CATALOG: readonly ToolSpec[] = [
	{
		name: "get_table_of_contents",
		description:
			"Get the full table of contents of the Urantia Papers. Returns the Foreword and the 4 parts, with all 197 papers and their titles.",
		parameters: { type: "object", properties: { lang: langProp } },
	},
	{
		name: "list_papers",
		description:
			"List all 197 Urantia Papers with their metadata (id, title, partId, labels). Use get_table_of_contents for a hierarchical view.",
		parameters: { type: "object", properties: { lang: langProp } },
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
				lang: langProp,
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
			properties: { paper_id: paperIdProp, lang: langProp },
			required: ["paper_id"],
		},
	},
	{
		name: "get_random_paragraph",
		description:
			"Get a random paragraph from the Urantia Papers. Great for daily quotes, exploration, or discovering new passages.",
		parameters: {
			type: "object",
			properties: {
				include_entities: includeEntitiesProp,
				include_bible_parallels: includeBibleParallelsProp,
				include_urantia_parallels: includeUrantiaParallelsProp,
				lang: langProp,
			},
		},
	},
	{
		name: "get_paragraph",
		description:
			'Look up a specific paragraph by reference. Supports three formats: globalId ("1:2.0.1"), standardReferenceId ("2:0.1"), or paperSectionParagraphId ("2.0.1"). The format is auto-detected.',
		parameters: {
			type: "object",
			properties: {
				ref: refParamProp,
				include_entities: includeEntitiesProp,
				include_bible_parallels: includeBibleParallelsProp,
				include_urantia_parallels: includeUrantiaParallelsProp,
				lang: langProp,
			},
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
				lang: langProp,
			},
			required: ["ref"],
		},
	},
	{
		name: "search",
		description:
			'Keyword search across all paragraphs in the Urantia Papers. Mode "auto" (default): a reference such as "68:6.3", "103:2", "Paper 68", or a bare number such as "68" (0 to 196) gives those paragraphs; otherwise the exact phrase first, then every word, then (when few) typo fixes and most of the words. Each result has `match` (reference, exact, all, near, most); `meta.didYouMean` gives the fixed query and `meta.see` names another work the query names. Other modes: "and" (all words), "or" (any word), "phrase" (exact phrase). Provide the search string as either `query` (preferred) or `q` (REST alias) — exactly one is required.',
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: 'Search query. Example: "nature of God"' },
				q: { type: "string", description: "Alias for `query` (REST compatibility)." },
				type: {
					type: "string",
					description: "Search mode",
					enum: ["auto", "phrase", "and", "or"],
					default: "auto",
				},
				paper_id: { type: "string", description: "Filter to a specific paper ID" },
				part_id: { type: "string", description: "Filter to a specific part ID (1-4)" },
				lang: langProp,
				page: pageProp,
				limit: limitProp,
				include_entities: includeEntitiesProp,
				include_bible_parallels: includeBibleParallelsProp,
				include_urantia_parallels: includeUrantiaParallelsProp,
			},
		},
	},
	{
		name: "semantic_search",
		description:
			'Search the Urantia Papers using semantic similarity (vector embeddings). Returns conceptually related results even without exact keyword matches. A reference such as "99:1.1" gives those paragraphs; a pasted paragraph gives itself first. Each result has `strength` (strong, related, weak) and `match` (reference, exact, similar). The list holds the 100 nearest; `meta.total` is the length of that list, and `meta.related` counts the related or better. Provide the search string as either `query` (preferred) or `q` (REST alias) — exactly one is required.',
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: 'Natural language query. Example: "What is the meaning of life?"',
				},
				q: { type: "string", description: "Alias for `query` (REST compatibility)." },
				paper_id: { type: "string", description: "Filter to a specific paper ID" },
				part_id: { type: "string", description: "Filter to a specific part ID (1-4)" },
				lang: {
					...langProp,
					description:
						'Language of the results. "es" gives the Spanish text and titles; the question can be in Spanish or English, and `strength` allows for the lower similarity of a Spanish question. Default "eng".',
				},
				page: pageProp,
				limit: limitProp,
				include_entities: includeEntitiesProp,
				include_bible_parallels: includeBibleParallelsProp,
				include_urantia_parallels: includeUrantiaParallelsProp,
			},
		},
	},
	{
		name: "list_entities",
		description:
			"Browse the entity catalog: beings, places, orders, races, religions, and concepts mentioned in the Urantia Papers. Supports filtering by type and searching by name. Provide the search string as either `query` or `q` (alias) — both are optional.",
		parameters: {
			type: "object",
			properties: {
				type: {
					type: "string",
					description: "Filter by entity type",
					enum: ["being", "place", "order", "race", "religion", "concept"],
				},
				query: { type: "string", description: "Search entities by name or alias" },
				q: { type: "string", description: "Alias for `query` (REST compatibility)." },
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
	{
		name: "list_bible_books",
		description:
			"List all 81 books of the World English Bible (eng-web): 39 OT + 15 deuterocanonical + 27 NT. Each entry includes OSIS book code, full name, abbreviation, canonical order, canon, and chapter/verse counts.",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "get_bible_book",
		description:
			"Get a single Bible book's metadata including chapter and verse counts. Accepts OSIS, USFM, full name, or alias for `book_code`.",
		parameters: {
			type: "object",
			properties: { book_code: bookCodeProp },
			required: ["book_code"],
		},
	},
	{
		name: "get_bible_chapter",
		description:
			"Get every verse in a Bible chapter, ordered by verse number. Accepts OSIS, USFM, full name, or alias for `book_code`.",
		parameters: {
			type: "object",
			properties: {
				book_code: bookCodeProp,
				chapter: { type: "integer", description: "Chapter number (1-indexed)", minimum: 1 },
			},
			required: ["book_code", "chapter"],
		},
	},
	{
		name: "get_bible_verse",
		description:
			"Get a single Bible verse from the World English Bible (eng-web). Accepts OSIS, USFM, full name, or alias for `book_code`.",
		parameters: {
			type: "object",
			properties: {
				book_code: bookCodeProp,
				chapter: { type: "integer", description: "Chapter number", minimum: 1 },
				verse: { type: "integer", description: "Verse number", minimum: 1 },
			},
			required: ["book_code", "chapter", "verse"],
		},
	},
	{
		name: "get_bible_verse_urantia_parallels",
		description:
			"Returns the top 10 Urantia paragraphs whose embeddings are nearest to the Bible chunk that contains this verse. Pre-computed via text-embedding-3-large cosine similarity. These are semantic neighbors, not a curated list of parallels.",
		parameters: {
			type: "object",
			properties: {
				book_code: bookCodeProp,
				chapter: { type: "integer", description: "Chapter number", minimum: 1 },
				verse: { type: "integer", description: "Verse number", minimum: 1 },
			},
			required: ["book_code", "chapter", "verse"],
		},
	},
	{
		name: "bible_semantic_search",
		description:
			"Free-form natural-language search across all Bible chunks, ranked by cosine similarity. Each result includes the top-N pre-computed Urantia paragraphs related to that chunk via `bible_parallels` (Bible → Urantia direction). One query surfaces both Bible matches and the relevant Urantia content. Provide the search string as either `query` or `q` (alias). Optional filters: `canon` and `book_code`.",
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: 'Natural language query. Example: "blessed are the poor"',
				},
				q: { type: "string", description: "Alias for `query` (REST compatibility)." },
				canon: {
					type: "string",
					description: "Filter by canon",
					enum: ["ot", "deuterocanon", "nt"],
				},
				book_code: {
					type: "string",
					description: 'Restrict to a single book. Example: "Matt" or "Matthew"',
				},
				page: pageProp,
				limit: limitProp,
				urantia_parallel_limit: {
					type: "integer",
					description:
						"How many Urantia paragraphs to attach per Bible result (0-10). Set to 0 to suppress.",
					default: 3,
					minimum: 0,
					maximum: 10,
				},
			},
		},
	},
	{
		name: "list_works",
		description:
			'List the works beside the Urantia Papers: the Bible (World English Bible) and 21 texts of the world\'s religions and traditions, each in the US public domain. `id` is what the other work tools take ("bible" or a slug such as "dhammapada").',
		parameters: { type: "object", properties: {} },
	},
	{
		name: "search_works",
		description:
			'Keyword search across the Bible and the other works, or one work with `work`. A reference such as "John 3:16", "Dhp 183", or "BG 2.47" gives those units first. Otherwise the exact phrase first, then every word, then (when few) a typo fix in `meta.didYouMean`. Each result has `match`, `url`, and its nearest Urantia paragraphs (semantic parallels, not curated ones). Provide `query` or `q`.',
		parameters: { type: "object", properties: workQueryProps },
	},
	{
		name: "works_semantic_search",
		description:
			"Natural-language search across the Bible and the other works, or one work with `work`. The list holds the 100 nearest chunks; each has `similarity` and `strength` (strong, related, weak), and `meta.total` is the length of that list, and `meta.related` counts the related or better. Each result has `url` and its nearest Urantia paragraphs. Provide `query` or `q`.",
		parameters: { type: "object", properties: workQueryProps },
	},
	{
		name: "read_work",
		description:
			'Read a work by reference: one unit, a short range of up to 50, or a chapter, each with its link. The prefix is optional ("BG 2.47" and "2.47" are the same); for the Bible, name the book ("John 3:16").',
		parameters: { type: "object", properties: workRefProps, required: ["work", "ref"] },
	},
	{
		name: "get_work_urantia_parallels",
		description:
			"The 10 Urantia paragraphs closest in meaning to one unit of a work. Semantic parallels, not curated ones. The reference must name one unit.",
		parameters: { type: "object", properties: workRefProps, required: ["work", "ref"] },
	},
	{
		name: "verify_quote",
		description:
			'Check whether a quoted passage is in the Urantia Papers. Returns `verdict` (exact, close, not_found), the reference and exact text of the best match, and each word that differs. A quote must be at least 4 words. Give `ref` (such as "2:5.1") to also check the reference the quote claims.',
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "The quoted passage to check. At least 4 words." },
				ref: { type: "string", description: 'The reference the quote claims, such as "2:5.1".' },
			},
			required: ["text"],
		},
	},
	{
		name: "get_citation",
		description:
			'A formatted citation of one paragraph of the Urantia Papers in APA, MLA, Chicago, or BibTeX. The ref is "196:2.1", "1:196.2.1", or "196.2.1".',
		parameters: {
			type: "object",
			properties: {
				ref: { type: "string", description: 'The paragraph, such as "196:2.1".' },
				style: {
					type: "string",
					description: "Citation style",
					enum: ["apa", "mla", "chicago", "bibtex"],
					default: "apa",
				},
			},
			required: ["ref"],
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
