import type { ExecutionContext } from "@cloudflare/workers-types";
import { Logtail } from "@logtail/edge";

export interface Logger {
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string | Error, context?: Record<string, unknown>): void;
	debug(message: string, context?: Record<string, unknown>): void;
	// Send every queued log line now. Absent on the console fallback.
	flush?(): Promise<void>;
}

// The part of the Logtail client this module uses. Tests pass a double.
type LogClient = {
	withExecutionContext(ctx: ExecutionContext): Omit<Logger, "flush">;
	flush(): Promise<unknown>;
};

const token = process.env.BETTERSTACK_SOURCE_TOKEN;

/**
 * Build the logger for one request.
 *
 * Each request gets its own BetterStack client. The client batches log lines
 * and flushes them from a timer. One client shared by all requests put every
 * request's lines in one batch, so a line from request B was sent, and its
 * promise resolved, from a timer that belonged to request A. Workers cancels
 * that: "your Worker's code had hung", with a cross-request promise warning,
 * on every route. A client per request keeps the batch, the timer, and the
 * promises inside the request that owns them.
 */
export function createRequestLogger(
	sourceToken: string | undefined,
	ctx: ExecutionContext | undefined,
	makeClient: (sourceToken: string) => LogClient = (t) => new Logtail(t),
): Logger {
	if (sourceToken && ctx) {
		const client = makeClient(sourceToken);
		const bound = client.withExecutionContext(ctx);
		return {
			info: (message, context) => bound.info(message, context),
			warn: (message, context) => bound.warn(message, context),
			error: (message, context) => bound.error(message, context),
			debug: (message, context) => bound.debug(message, context),
			flush: async () => {
				await client.flush();
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
 * Returns a BetterStack logger for the current request's ExecutionContext,
 * or a console-based fallback for local development.
 */
export function getLogger(ctx?: ExecutionContext): Logger {
	return createRequestLogger(token, ctx);
}
