import { describe, expect, it } from "bun:test";
import { classifyUserAgent } from "../../src/lib/ua-family.ts";

describe("classifyUserAgent", () => {
	it("returns 'unknown' for null/empty input", () => {
		expect(classifyUserAgent(null)).toBe("unknown");
		expect(classifyUserAgent(undefined)).toBe("unknown");
		expect(classifyUserAgent("")).toBe("unknown");
	});

	it("classifies Claude Code variants", () => {
		expect(classifyUserAgent("claude-code/1.0.42 (darwin)")).toBe("claude-code");
		expect(classifyUserAgent("Claude_Code 2.1")).toBe("claude-code");
		expect(classifyUserAgent("ClaudeCode/0.9")).toBe("claude-code");
	});

	it("classifies Anthropic SDKs separately from Claude Code", () => {
		expect(classifyUserAgent("anthropic-ai/0.25.0")).toBe("anthropic-sdk");
		expect(classifyUserAgent("anthropic-typescript/1.0")).toBe("anthropic-sdk");
		expect(classifyUserAgent("anthropic-python/0.40")).toBe("anthropic-sdk");
	});

	it("classifies OpenAI clients", () => {
		expect(classifyUserAgent("openai-python/1.50.0")).toBe("openai");
		expect(classifyUserAgent("Mozilla/5.0 ... ChatGPT")).toBe("openai");
		expect(classifyUserAgent("gpt-4 client")).toBe("openai");
	});

	it("classifies generic Claude/Anthropic UAs", () => {
		expect(classifyUserAgent("Claude (mobile)")).toBe("claude");
	});

	it("classifies MCP clients", () => {
		expect(classifyUserAgent("mcp-client/0.1")).toBe("mcp-client");
		expect(classifyUserAgent("model-context-protocol/runtime")).toBe("mcp-client");
	});

	it("classifies bots before browsers", () => {
		expect(classifyUserAgent("Googlebot/2.1 (Mozilla/5.0)")).toBe("bot-crawler");
		expect(classifyUserAgent("MyScraper Spider")).toBe("bot-crawler");
	});

	it("classifies real browsers", () => {
		expect(
			classifyUserAgent(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
			),
		).toBe("browser");
		expect(classifyUserAgent("Firefox/130.0")).toBe("browser");
	});

	it("classifies SDK/CLI fetchers", () => {
		expect(classifyUserAgent("curl/8.7.1")).toBe("sdk-fetch");
		expect(classifyUserAgent("node-fetch/3.0")).toBe("sdk-fetch");
		expect(classifyUserAgent("python-requests/2.31")).toBe("sdk-fetch");
	});

	it("falls back to unknown for unfamiliar UAs", () => {
		expect(classifyUserAgent("CustomInternalAgent/9.9")).toBe("unknown");
	});
});
