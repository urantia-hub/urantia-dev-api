import type { ExecutionContext } from "@cloudflare/workers-types";
import type { MiddlewareHandler } from "hono";
import { getLogger, type Logger } from "../lib/logger.ts";
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

	logger.info("request", {
		method: c.req.method,
		path: c.req.path,
		status: c.res.status,
		duration_ms: duration,
		...(await callerFields(c.req.raw.headers, pepper)),
		...mcp,
		referer: c.req.header("referer") ?? undefined,
		cf_ray: c.req.header("cf-ray") ?? undefined,
	});

	// Send this request's log lines now, inside its own context. Without this
	// the client waits for its one-second batch timer before it sends.
	if (ctx && logger.flush) ctx.waitUntil(logger.flush().catch(() => {}));
};
