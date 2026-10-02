import { describe, expect, it } from "bun:test";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { createRequestLogger } from "../../src/lib/logger.ts";

// A stand-in for the BetterStack client that records what each instance does.
function fakeClients() {
	const made: Array<{ lines: string[]; flushes: number; ctx: unknown }> = [];
	const makeClient = () => {
		const record = { lines: [] as string[], flushes: 0, ctx: undefined as unknown };
		made.push(record);
		return {
			withExecutionContext: (ctx: ExecutionContext) => {
				record.ctx = ctx;
				const push = (level: string) => (message: string | Error) => {
					record.lines.push(`${level}:${String(message)}`);
				};
				return {
					info: push("info"),
					warn: push("warn"),
					error: push("error"),
					debug: push("debug"),
				};
			},
			flush: async () => {
				record.flushes++;
			},
		};
	};
	return { made, makeClient };
}

const ctx = (name: string) =>
	({ name, waitUntil() {}, passThroughOnException() {} }) as unknown as ExecutionContext;

describe("createRequestLogger", () => {
	it("gives each request its own client, so one request never flushes another's lines", async () => {
		const { made, makeClient } = fakeClients();
		const a = createRequestLogger("token", ctx("a"), makeClient);
		const b = createRequestLogger("token", ctx("b"), makeClient);

		a.info("from a");
		b.info("from b");
		await a.flush?.();

		expect(made).toHaveLength(2);
		expect(made[0]?.lines).toEqual(["info:from a"]);
		expect(made[1]?.lines).toEqual(["info:from b"]);
		expect(made[0]?.flushes).toBe(1);
		expect(made[1]?.flushes).toBe(0);
		expect((made[0]?.ctx as { name: string }).name).toBe("a");
		expect((made[1]?.ctx as { name: string }).name).toBe("b");
	});

	it("falls back to the console without a token or without an execution context", () => {
		const { made, makeClient } = fakeClients();
		expect(createRequestLogger(undefined, ctx("a"), makeClient).flush).toBeUndefined();
		expect(createRequestLogger("token", undefined, makeClient).flush).toBeUndefined();
		expect(made).toHaveLength(0);
	});
});
