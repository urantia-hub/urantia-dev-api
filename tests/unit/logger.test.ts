import { describe, expect, it } from "bun:test";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { createRequestLogger, POSTHOG_LOGS_URL } from "../../src/lib/logger.ts";

// biome-ignore lint/suspicious/noExplicitAny: OTLP bodies are read loosely
type Loose = any;

// A stand-in for fetch that records every request it is given.
function fakeSend() {
	const sent: { url: string; init: RequestInit; body: Loose }[] = [];
	const send = async (url: string, init: RequestInit) => {
		sent.push({ url, init, body: JSON.parse(String(init.body)) });
		return new Response(null, { status: 200 });
	};
	return { sent, send };
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe("createRequestLogger", () => {
	it("sends one OTLP batch to PostHog Logs with the project token", async () => {
		const { sent, send } = fakeSend();
		const logger = createRequestLogger("phc_test", ctx, send);
		logger.info("request", { path: "/toc", status: 200, duration_ms: 12, is_bot: false });
		logger.error(new Error("boom"), { path: "/x" });
		await logger.flush?.();

		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(POSTHOG_LOGS_URL);
		expect((sent[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer phc_test");

		const resource = sent[0]?.body.resourceLogs[0];
		expect(resource.resource.attributes).toContainEqual({
			key: "service.name",
			value: { stringValue: "urantia-dev-api" },
		});
		const [info, error] = resource.scopeLogs[0].logRecords;
		expect(info.severityText).toBe("INFO");
		expect(info.severityNumber).toBe(9);
		expect(info.body).toEqual({ stringValue: "request" });
		expect(info.attributes).toContainEqual({ key: "status", value: { intValue: "200" } });
		expect(info.attributes).toContainEqual({ key: "is_bot", value: { boolValue: false } });
		expect(error.severityText).toBe("ERROR");
		expect(error.body).toEqual({ stringValue: "boom" });
	});

	it("keeps each request's lines apart, and sends nothing when a request logged nothing", async () => {
		const { sent, send } = fakeSend();
		const a = createRequestLogger("phc_test", ctx, send);
		const b = createRequestLogger("phc_test", ctx, send);
		a.info("from a");
		await b.flush?.();
		expect(sent).toHaveLength(0);
		await a.flush?.();
		await a.flush?.();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.body.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
	});

	it("drops empty fields instead of sending them", async () => {
		const { sent, send } = fakeSend();
		const logger = createRequestLogger("phc_test", ctx, send);
		logger.info("request", { referer: undefined, mcp_tool: null, path: "/" });
		await logger.flush?.();
		const keys = sent[0]?.body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map(
			(a: Loose) => a.key,
		);
		expect(keys).toEqual(["path"]);
	});

	it("falls back to the console without a token or without an execution context", () => {
		const { sent, send } = fakeSend();
		expect(createRequestLogger(undefined, ctx, send).flush).toBeUndefined();
		expect(createRequestLogger("phc_test", undefined, send).flush).toBeUndefined();
		expect(sent).toHaveLength(0);
	});
});
