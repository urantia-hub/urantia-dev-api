import type { Context } from "hono";

type ProblemStatus = 400 | 401 | 403 | 404 | 429 | 500 | 503;

const STATUS_TITLES: Record<ProblemStatus, string> = {
	400: "Bad Request",
	401: "Unauthorized",
	403: "Forbidden",
	404: "Not Found",
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
) {
	const slug = type ?? STATUS_TITLES[status].toLowerCase().replace(/\s+/g, "-");

	return c.json(
		{
			type: `https://urantia.dev/errors/${slug}`,
			title: STATUS_TITLES[status],
			status,
			detail,
		},
		status,
		{ "Content-Type": "application/problem+json" },
	);
}
