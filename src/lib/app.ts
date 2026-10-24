import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "../types/env.ts";
import { problemJson } from "./errors.ts";

/**
 * Create an OpenAPIHono instance with the shared defaultHook
 * that formats Zod validation errors as RFC 9457 problem+json.
 */
export function createApp<T extends Record<string, unknown> = Env>() {
	return new OpenAPIHono<T>({
		defaultHook: (result, c) => {
			if (!result.success) {
				const firstIssue = result.error.issues[0];
				const detail = firstIssue
					? `${firstIssue.path.join(".")}: ${firstIssue.message}`
					: "Validation failed";
				return problemJson(c, 400, detail, "validation-error");
			}
		},
	});
}
