import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { createApp } from "../lib/app.ts";
import { toAnthropicTools, toOpenAITools } from "../lib/tool-catalog.ts";

export const toolsRoute = createApp();

const ToolParameterSchema: z.ZodType<unknown> = z.lazy(() =>
	z.object({
		type: z.string(),
		properties: z.record(z.string(), z.any()).optional(),
		required: z.array(z.string()).optional(),
		description: z.string().optional(),
	}),
);

const OpenAIToolSchema = z.object({
	type: z.literal("function"),
	function: z.object({
		name: z.string(),
		description: z.string(),
		parameters: ToolParameterSchema,
	}),
});

const AnthropicToolSchema = z.object({
	name: z.string(),
	description: z.string(),
	input_schema: ToolParameterSchema,
});

const OpenAIToolsResponse = z.object({
	server: z.object({
		name: z.string(),
		base_url: z.string(),
	}),
	tools: z.array(OpenAIToolSchema),
});

const AnthropicToolsResponse = z.object({
	server: z.object({
		name: z.string(),
		base_url: z.string(),
	}),
	tools: z.array(AnthropicToolSchema),
});

const SERVER_META = {
	name: "Urantia Papers API",
	base_url: "https://api.urantia.dev",
} as const;

const getOpenAIToolsRoute = createRoute({
	operationId: "getOpenAITools",
	method: "get",
	path: "/openai",
	tags: ["Tools"],
	summary: "Function-calling schemas for OpenAI",
	description: `Returns the full Urantia Papers API tool catalog as ready-to-use OpenAI function-calling schemas.

Drop into any OpenAI Chat Completions or Assistants call:

\`\`\`ts
const { tools } = await fetch("https://api.urantia.dev/tools/openai").then(r => r.json());
const completion = await openai.chat.completions.create({
  model: "gpt-5",
  messages,
  tools, // ready to go
});
\`\`\`

Each tool corresponds 1:1 with an MCP tool exposed at /mcp; you can run the call yourself against the relevant REST endpoint or use the published \`@urantia/api\` SDK to dispatch.`,
	responses: {
		200: {
			description: "OpenAI tool definitions",
			content: { "application/json": { schema: OpenAIToolsResponse } },
		},
	},
});

toolsRoute.openapi(getOpenAIToolsRoute, (c) =>
	c.json({ server: SERVER_META, tools: toOpenAITools() }, 200),
);

const getAnthropicToolsRoute = createRoute({
	operationId: "getAnthropicTools",
	method: "get",
	path: "/anthropic",
	tags: ["Tools"],
	summary: "Function-calling schemas for Anthropic",
	description: `Returns the full Urantia Papers API tool catalog as ready-to-use Anthropic Messages \`tools\` definitions.

Drop into any Anthropic Messages call:

\`\`\`ts
const { tools } = await fetch("https://api.urantia.dev/tools/anthropic").then(r => r.json());
const message = await anthropic.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 1024,
  tools, // ready to go
  messages,
});
\`\`\`

Each tool corresponds 1:1 with an MCP tool exposed at /mcp.`,
	responses: {
		200: {
			description: "Anthropic tool definitions",
			content: { "application/json": { schema: AnthropicToolsResponse } },
		},
	},
});

toolsRoute.openapi(getAnthropicToolsRoute, (c) =>
	c.json({ server: SERVER_META, tools: toAnthropicTools() }, 200),
);
