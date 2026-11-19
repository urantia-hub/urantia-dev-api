import type { Context } from "hono";

type ProblemStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 500 | 503;

const STATUS_TITLES: Record<ProblemStatus, string> = {
	400: "Bad Request",
	401: "Unauthorized",
	403: "Forbidden",
	404: "Not Found",
	409: "Conflict",
	410: "Gone",
	413: "Content Too Large",
	429: "Too Many Requests",
	500: "Internal Server Error",
	503: "Service Unavailable",
};

/**
 * Return an RFC 9457 Problem Details response (application/problem+json).
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457
 */
export function problemJson<S extends ProblemStatus>(
	c: Context,
	status: S,
	detail: string,
	type?: string,
	extensions?: Record<string, unknown>,
) {
	const slug = type ?? STATUS_TITLES[status].toLowerCase().replace(/\s+/g, "-");

	return c.json(
		{
			type: `https://urantia.dev/errors/${slug}`,
			title: STATUS_TITLES[status],
			status,
			detail,
			...extensions,
		},
		status,
		{ "Content-Type": "application/problem+json" },
	);
}

/** Message and code of the deepest `cause` of an error, for logs (Drizzle hides the Postgres error there). */
export function errorCause(err: unknown): { cause?: string; cause_code?: string } {
	let e: unknown = (err as { cause?: unknown } | null)?.cause;
	if (e === undefined || e === null) return {};
	const seen = new Set<unknown>([err]);
	while (e !== null && typeof e === "object" && "cause" in e && (e as { cause?: unknown }).cause != null && !seen.has(e)) {
		seen.add(e);
		e = (e as { cause?: unknown }).cause;
	}
	if (e instanceof Error) {
		const code = (e as { code?: unknown }).code;
		return { cause: e.message, ...(code != null ? { cause_code: String(code) } : {}) };
	}
	return { cause: String(e) };
}
