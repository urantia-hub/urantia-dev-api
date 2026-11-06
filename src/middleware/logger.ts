import type { ExecutionContext } from "@cloudflare/workers-types";
import type { MiddlewareHandler } from "hono";
import { getDb } from "../db/client.ts";
import { getLogger, type Logger } from "../lib/logger.ts";
import { recordMcpCalls } from "../lib/mcp-usage.ts";
import { callerFields, readMcpSummary } from "../lib/request-log.ts";

declare module "hono" {
	interface ContextVariableMap {
		logger: Logger;
	}
}

export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
	const start = Date.now();

	// Bind logger to this request's execution context
	let ctx: ExecutionContext | undefined;
	try {
		ctx = c.executionCtx;
	} catch {
		// Bun dev mode — no ExecutionContext
	}
	const logger = getLogger(ctx);
	c.set("logger", logger);

	// Read the MCP body before the route consumes it. Only POST /mcp has one.
	const mcp =
		c.req.method === "POST" && c.req.path === "/mcp" ? await readMcpSummary(c.req.raw) : {};

	await next();

	const duration = Date.now() - start;
	const pepper = c.env?.FEEDBACK_IP_PEPPER ?? process.env.FEEDBACK_IP_PEPPER;

	const caller = await callerFields(c.req.raw.headers, pepper);
	logger.info("request", {
		method: c.req.method,
		path: c.req.path,
		status: c.res.status,
		duration_ms: duration,
		...caller,
		...mcp,
		referer: c.req.header("referer") ?? undefined,
		cf_ray: c.req.header("cf-ray") ?? undefined,
	});

	// Count the tool calls of a person's assistant for urantia.dev/vision. A bot or a failed request is not counted.
	if (ctx && mcp.mcp_tool && !caller.is_bot && c.res.status < 400 && c.env?.HYPERDRIVE) {
		const { db } = getDb(c.env.HYPERDRIVE);
		ctx.waitUntil(
			recordMcpCalls(db, caller.ua_family, mcp.mcp_tool.split(",")).catch((err) =>
				logger.warn("mcp usage count failed", { error: String(err) }),
			),
		);
	}

	// Send this request's log lines now, inside its own context. Without this
	// the client waits for its one-second batch timer before it sends.
	if (ctx && logger.flush) ctx.waitUntil(logger.flush().catch(() => {}));
};
