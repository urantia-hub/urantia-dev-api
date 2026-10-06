import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	buildAlertEmail,
	createAlertWebhookRoute,
	MAX_EMAILS_PER_HOUR,
} from "../../src/routes/alert-webhook.ts";

const TOKEN = "test-token-123";
let ipCounter = 0;

function call(
	app: ReturnType<typeof createAlertWebhookRoute>,
	query: string,
	body: string,
	ip?: string,
) {
	return app.request(`/${query}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"cf-connecting-ip": ip ?? `alert-test-${++ipCounter}`,
		},
		body,
	});
}

describe("POST /hooks/posthog-alerts", () => {
	const saved = { ...process.env };
	beforeEach(() => {
		process.env.ALERT_WEBHOOK_TOKEN = TOKEN;
		process.env.RESEND_API_KEY = "re_test";
		process.env.FEEDBACK_FROM = "alerts@urantia.dev";
		process.env.FEEDBACK_TO = "me@example.com";
	});
	afterEach(() => {
		process.env = { ...saved };
	});

	it("emails the alert when the token matches", async () => {
		const sent: { subject: string; text: string }[] = [];
		const app = createAlertWebhookRoute(async (_env, message) => {
			sent.push(message);
			return { status: "sent" };
		});
		const res = await call(
			app,
			`?token=${TOKEN}`,
			JSON.stringify({ alert_name: "API errors", state: "firing" }),
		);
		expect(res.status).toBe(204);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.subject).toBe("[urantia.dev] API errors: firing");
		expect(sent[0]?.text).toContain('"state": "firing"');
	});

	it("answers 404 and sends nothing for a wrong or missing token", async () => {
		let sends = 0;
		const app = createAlertWebhookRoute(async () => {
			sends++;
			return { status: "sent" };
		});
		expect((await call(app, "?token=wrong", "{}")).status).toBe(404);
		expect((await call(app, "", "{}")).status).toBe(404);
		expect(sends).toBe(0);
	});

	it("answers 404 when no token is configured, even for an empty guess", async () => {
		delete process.env.ALERT_WEBHOOK_TOKEN;
		const app = createAlertWebhookRoute(async () => ({ status: "sent" }));
		expect((await call(app, "?token=", "{}")).status).toBe(404);
	});

	it("rate limits one IP, wrong guesses included", async () => {
		const app = createAlertWebhookRoute(async () => ({ status: "sent" }));
		const statuses = [];
		for (let i = 0; i < 7; i++)
			statuses.push((await call(app, "?token=guess", "{}", "same-ip")).status);
		expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
		expect(statuses.slice(5)).toEqual([429, 429]);
	});

	it("caps the emails per hour, then sends again after the hour", async () => {
		let clock = 1_000_000;
		let sends = 0;
		const app = createAlertWebhookRoute(
			async () => {
				sends++;
				return { status: "sent" };
			},
			() => clock,
		);
		for (let i = 0; i < MAX_EMAILS_PER_HOUR + 2; i++) await call(app, `?token=${TOKEN}`, "{}");
		expect(sends).toBe(MAX_EMAILS_PER_HOUR);
		expect((await call(app, `?token=${TOKEN}`, "{}")).status).toBe(429);
		clock += 3_600_000;
		expect((await call(app, `?token=${TOKEN}`, "{}")).status).toBe(204);
		expect(sends).toBe(MAX_EMAILS_PER_HOUR + 1);
	});

	it("rejects a body over the cap", async () => {
		const app = createAlertWebhookRoute(async () => ({ status: "sent" }));
		const res = await call(app, `?token=${TOKEN}`, JSON.stringify({ pad: "a".repeat(40_000) }));
		expect(res.status).toBe(413);
	});

	it("reports a failed delivery as 502", async () => {
		const app = createAlertWebhookRoute(async () => ({ status: "failed", reason: "HTTP 500" }));
		expect((await call(app, `?token=${TOKEN}`, "{}")).status).toBe(502);
	});
});

describe("buildAlertEmail", () => {
	it("falls back to a plain subject when the payload has no name", () => {
		expect(buildAlertEmail({ foo: 1 }, "{}").subject).toBe("[urantia.dev] PostHog log alert");
	});

	it("finds the name one level down", () => {
		expect(buildAlertEmail({ alert: { name: "Errors", status: "resolved" } }, "{}").subject).toBe(
			"[urantia.dev] Errors: resolved",
		);
	});
});
