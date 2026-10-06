import type { ExecutionContext } from "@cloudflare/workers-types";

export interface Logger {
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string | Error, context?: Record<string, unknown>): void;
	debug(message: string, context?: Record<string, unknown>): void;
	// Send every queued log line now. Absent on the console fallback.
	flush?(): Promise<void>;
}

type Level = "debug" | "info" | "warn" | "error";
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const POSTHOG_LOGS_URL = "https://us.i.posthog.com/i/v1/logs";
export const SERVICE_NAME = "urantia-dev-api";

// OpenTelemetry severity numbers for each level.
const SEVERITY: Record<Level, number> = { debug: 5, info: 9, warn: 13, error: 17 };

type AnyValue =
	| { stringValue: string }
	| { boolValue: boolean }
	| { intValue: string }
	| { doubleValue: number };

function toAnyValue(value: unknown): AnyValue {
	if (typeof value === "boolean") return { boolValue: value };
	if (typeof value === "number") {
		return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
	}
	if (typeof value === "string") return { stringValue: value };
	return { stringValue: JSON.stringify(value) };
}

function toAttributes(context: Record<string, unknown> | undefined) {
	return Object.entries(context ?? {})
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([key, value]) => ({ key, value: toAnyValue(value) }));
}

/** One OTLP/HTTP JSON body for a batch of log records. */
export function otlpBody(records: object[]) {
	return {
		resourceLogs: [
			{
				resource: {
					attributes: toAttributes({ "service.name": SERVICE_NAME, app: "urantia-dev" }),
				},
				scopeLogs: [{ scope: { name: SERVICE_NAME }, logRecords: records }],
			},
		],
	};
}

/**
 * Build the logger for one request.
 *
 * Each request keeps its own buffer, and the middleware sends it once at the end
 * of the request inside ctx.waitUntil. Nothing is shared between requests, so a
 * line is never sent from another request's context (Workers cancels that).
 */
export function createRequestLogger(
	projectToken: string | undefined,
	ctx: ExecutionContext | undefined,
	send: FetchLike = (url, init) => fetch(url, init),
): Logger {
	if (projectToken && ctx) {
		let records: object[] = [];
		const push = (level: Level) => (message: string | Error, context?: Record<string, unknown>) => {
			const text = message instanceof Error ? message.message : message;
			records.push({
				timeUnixNano: `${Date.now()}000000`,
				severityNumber: SEVERITY[level],
				severityText: level.toUpperCase(),
				body: { stringValue: text },
				attributes: toAttributes(context),
			});
		};
		return {
			info: push("info"),
			warn: push("warn"),
			error: push("error"),
			debug: push("debug"),
			flush: async () => {
				if (records.length === 0) return;
				const batch = records;
				records = [];
				await send(POSTHOG_LOGS_URL, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${projectToken}`,
					},
					body: JSON.stringify(otlpBody(batch)),
				});
			},
		};
	}

	// Dev fallback: structured console output
	return {
		info(message, context) {
			console.log(JSON.stringify({ level: "info", message, ...context }));
		},
		warn(message, context) {
			console.warn(JSON.stringify({ level: "warn", message, ...context }));
		},
		error(message, context) {
			const msg = message instanceof Error ? message.message : message;
			console.error(JSON.stringify({ level: "error", message: msg, ...context }));
		},
		debug(message, context) {
			console.debug(JSON.stringify({ level: "debug", message, ...context }));
		},
	};
}

/**
 * Returns a PostHog logger for the current request's ExecutionContext,
 * or a console-based fallback for local development.
 */
export function getLogger(ctx?: ExecutionContext): Logger {
	return createRequestLogger(process.env.POSTHOG_KEY, ctx);
}
