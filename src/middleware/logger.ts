import type { ExecutionContext } from "@cloudflare/workers-types";
import type { MiddlewareHandler } from "hono";
import { getLogger, type Logger } from "../lib/logger.ts";

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

	await next();

	const duration = Date.now() - start;
	const ip =
		c.req.header("cf-connecting-ip") ??
		c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown";

	logger.info("request", {
		method: c.req.method,
		path: c.req.path,
		status: c.res.status,
		duration_ms: duration,
		ip,
		user_agent: c.req.header("user-agent") ?? "unknown",
		referer: c.req.header("referer") ?? undefined,
		cf_ray: c.req.header("cf-ray") ?? undefined,
	});
};
