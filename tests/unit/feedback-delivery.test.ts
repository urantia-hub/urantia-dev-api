import { describe, expect, it } from "bun:test";
import {
	type FetchLike,
	hashIp,
	postFeedbackToSlack,
	sendFeedbackEmail,
} from "../../src/lib/feedback-delivery.ts";
import type { FeedbackRecord } from "../../src/lib/feedback-sanitize.ts";

const FEEDBACK: FeedbackRecord = {
	id: "abc12345-0000-4000-8000-000000000000",
	receivedAt: "2026-10-02T12:00:00.000Z",
	category: "bug",
	message: "<script>alert(1)</script> **@everyone**",
	ref: null,
	endpoint: "/search",
	requestId: null,
	client: "curl",
	contact: null,
	pageUrl: null,
	userAgent: null,
};

const EMAIL_ENV = {
	RESEND_API_KEY: "re_test_key",
	FEEDBACK_FROM: "feedback@example.com",
	FEEDBACK_TO: "one@example.com, two@example.com,",
};

type Call = { url: string; init: RequestInit };

// A fetch double that records each call and returns the given status.
function fakeFetch(status = 200) {
	const calls: Call[] = [];
	const impl: FetchLike = async (url, init) => {
		calls.push({ url, init });
		return new Response("{}", { status });
	};
	return { calls, impl };
}

describe("hashIp", () => {
	it("returns a 64-character hex digest, not the IP", async () => {
		const hash = await hashIp("203.0.113.7", "pepper");
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).not.toContain("203.0.113.7");
	});

	it("is stable for one IP and one pepper", async () => {
		expect(await hashIp("203.0.113.7", "pepper")).toBe(await hashIp("203.0.113.7", "pepper"));
	});

	it("changes with the IP and with the pepper", async () => {
		const base = await hashIp("203.0.113.7", "pepper");
		expect(await hashIp("203.0.113.8", "pepper")).not.toBe(base);
		expect(await hashIp("203.0.113.7", "other")).not.toBe(base);
	});
});

describe("sendFeedbackEmail", () => {
	it("posts a plain-text email to Resend", async () => {
		const { calls, impl } = fakeFetch();
		const result = await sendFeedbackEmail(EMAIL_ENV, FEEDBACK, impl);

		expect(result).toEqual({ status: "sent" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.resend.com/emails");

		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer re_test_key");

		const body = JSON.parse(calls[0]?.init.body as string);
		expect(body.from).toBe("feedback@example.com");
		expect(body.to).toEqual(["one@example.com", "two@example.com"]);
		expect(body.subject).toBe("[Urantia feedback] bug · abc12345");
		expect(body.html).toBeUndefined();
		expect(body.text).toContain("--- BEGIN UNTRUSTED FEEDBACK ---");
		expect(body.text).toContain("> <script>alert(1)</script> **@everyone**");
	});

	for (const missing of ["RESEND_API_KEY", "FEEDBACK_FROM", "FEEDBACK_TO"] as const) {
		it(`skips without a request when ${missing} is not set`, async () => {
			const { calls, impl } = fakeFetch();
			const result = await sendFeedbackEmail(
				{ ...EMAIL_ENV, [missing]: undefined },
				FEEDBACK,
				impl,
			);
			expect(result.status).toBe("skipped");
			expect(calls).toHaveLength(0);
		});
	}

	it("skips when FEEDBACK_TO has no address", async () => {
		const { calls, impl } = fakeFetch();
		const result = await sendFeedbackEmail({ ...EMAIL_ENV, FEEDBACK_TO: " , " }, FEEDBACK, impl);
		expect(result.status).toBe("skipped");
		expect(calls).toHaveLength(0);
	});

	it("reports a failure for a non-2xx response", async () => {
		const { impl } = fakeFetch(422);
		expect(await sendFeedbackEmail(EMAIL_ENV, FEEDBACK, impl)).toEqual({
			status: "failed",
			reason: "HTTP 422",
		});
	});

	it("reports a failure when the request throws", async () => {
		const impl: FetchLike = async () => {
			throw new TypeError("network down");
		};
		expect(await sendFeedbackEmail(EMAIL_ENV, FEEDBACK, impl)).toEqual({
			status: "failed",
			reason: "TypeError",
		});
	});
});

describe("postFeedbackToSlack", () => {
	const SLACK_ENV = { SLACK_FEEDBACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/x" };

	it("skips without a request when the webhook is not set", async () => {
		const { calls, impl } = fakeFetch();
		expect((await postFeedbackToSlack({}, FEEDBACK, impl)).status).toBe("skipped");
		expect(calls).toHaveLength(0);
	});

	it("posts a sanitized message to the webhook", async () => {
		const { calls, impl } = fakeFetch();
		const result = await postFeedbackToSlack(SLACK_ENV, FEEDBACK, impl);

		expect(result).toEqual({ status: "sent" });
		expect(calls[0]?.url).toBe(SLACK_ENV.SLACK_FEEDBACK_WEBHOOK_URL);

		const { text } = JSON.parse(calls[0]?.init.body as string);
		expect(text).toContain("*Untrusted feedback.*");
		expect(text).toContain("&lt;script&gt;");
		expect(text).not.toContain("<script>");
		expect(text).not.toContain("@everyone");
	});

	it("reports a failure for a non-2xx response", async () => {
		const { impl } = fakeFetch(500);
		expect((await postFeedbackToSlack(SLACK_ENV, FEEDBACK, impl)).status).toBe("failed");
	});
});
