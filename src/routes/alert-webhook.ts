import { Hono } from "hono";
import { type FeedbackEnv, sendPlainEmail } from "../lib/feedback-delivery.ts";
import { readCapped } from "../lib/request-log.ts";
import { rateLimiter } from "../middleware/rate-limit.ts";
import type { Env } from "../types/env.ts";

// PostHog log alerts call this URL, and it emails the alert to FEEDBACK_TO.
// It is not in the OpenAPI spec. The token in the query string is the only key.
const MAX_BODY = 32_000;
// Per IP, and it counts wrong-token guesses too.
const REQUESTS_PER_MINUTE = 5;
// At most this many emails per hour from one Worker instance, whatever the caller.
export const MAX_EMAILS_PER_HOUR = 12;

type Loose = Record<string, unknown>;

function timingSafeEqual(a: string, b: string): boolean {
	const x = new TextEncoder().encode(a);
	const y = new TextEncoder().encode(b);
	if (x.length !== y.length) return false;
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}

// The payload shape is not documented, so look for common names one level deep.
function pick(payload: unknown, keys: string[]): string | undefined {
	const layers = [payload, ...Object.values((payload as Loose) ?? {})].filter(
		(v): v is Loose => !!v && typeof v === "object",
	);
	for (const layer of layers) {
		for (const key of keys) {
			const value = layer[key];
			if (typeof value === "string" && value) return value.slice(0, 120);
		}
	}
	return undefined;
}

/** The email for one alert event. */
export function buildAlertEmail(payload: unknown, raw: string) {
	const name = pick(payload, ["alert_name", "alertName", "name", "title"]) ?? "PostHog log alert";
	const state = pick(payload, ["state", "status", "event", "type"]);
	return {
		subject: `[urantia.dev] ${name}${state ? `: ${state}` : ""}`,
		text: [
			"A PostHog log alert sent this event.",
			"",
			"Logs: https://us.posthog.com (Logs, service urantia-dev-api)",
			"",
			"Payload:",
			raw,
		].join("\n"),
	};
}

type AlertEnv = Env & { Bindings: { ALERT_WEBHOOK_TOKEN?: string } };

export function createAlertWebhookRoute(send = sendPlainEmail, now = () => Date.now()) {
	const route = new Hono<AlertEnv>();
	let windowStart = 0;
	let sentInWindow = 0;

	route.use(
		"*",
		rateLimiter({ windowMs: 60_000, max: REQUESTS_PER_MINUTE, scope: "alert-webhook" }),
	);
	route.post("/", async (c) => {
		const expected = c.env?.ALERT_WEBHOOK_TOKEN ?? process.env.ALERT_WEBHOOK_TOKEN;
		const given = c.req.query("token") ?? "";
		// Answer 404 for a wrong token, so the URL looks like any other unknown path.
		if (!expected || !timingSafeEqual(given, expected)) return c.notFound();

		const body = c.req.raw.body;
		const raw = body ? await readCapped(body, MAX_BODY) : "";
		if (raw === undefined) return c.text("Payload too large", 413);

		let payload: unknown = raw;
		try {
			payload = JSON.parse(raw);
		} catch {
			// Not JSON: send the text as it came.
		}
		const pretty = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

		const time = now();
		if (time - windowStart >= 3_600_000) {
			windowStart = time;
			sentInWindow = 0;
		}
		if (sentInWindow >= MAX_EMAILS_PER_HOUR) {
			c.get("logger")?.warn("alert_webhook", { delivery: "capped" });
			return c.body(null, 429);
		}
		sentInWindow++;

		const env: FeedbackEnv = {
			RESEND_API_KEY: c.env?.RESEND_API_KEY ?? process.env.RESEND_API_KEY,
			FEEDBACK_FROM: c.env?.FEEDBACK_FROM ?? process.env.FEEDBACK_FROM,
			FEEDBACK_TO: c.env?.FEEDBACK_TO ?? process.env.FEEDBACK_TO,
		};
		const result = await send(env, buildAlertEmail(payload, pretty));
		c.get("logger")?.info("alert_webhook", { delivery: result.status });
		return c.body(null, result.status === "failed" ? 502 : 204);
	});
	return route;
}

export const alertWebhookRoute = createAlertWebhookRoute();
