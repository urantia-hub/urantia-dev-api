import { buildFeedbackEmail, buildSlackPayload, type FeedbackRecord } from "./feedback-sanitize.ts";

const RESEND_URL = "https://api.resend.com/emails";
const DELIVERY_TIMEOUT_MS = 5000;

export type FeedbackEnv = {
	RESEND_API_KEY?: string;
	FEEDBACK_FROM?: string;
	FEEDBACK_TO?: string;
	SLACK_FEEDBACK_WEBHOOK_URL?: string;
	FEEDBACK_IP_PEPPER?: string;
};

// The part of `fetch` that delivery uses. Tests pass a double.
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type DeliveryResult =
	| { status: "sent" }
	| { status: "skipped"; reason: string }
	| { status: "failed"; reason: string };

/** HMAC-SHA256 of the IP, keyed by a server secret. The raw IP is never stored. */
export async function hashIp(ip: string, pepper: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(pepper),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(ip));
	return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

async function postJson(
	fetchImpl: FetchLike,
	url: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<DeliveryResult> {
	try {
		const res = await fetchImpl(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
		});
		return res.ok ? { status: "sent" } : { status: "failed", reason: `HTTP ${res.status}` };
	} catch (err) {
		return { status: "failed", reason: err instanceof Error ? err.name : "unknown error" };
	}
}

/** Send the plain-text email through the Resend HTTP API. Skips when not configured. */
export async function sendFeedbackEmail(
	env: FeedbackEnv,
	feedback: FeedbackRecord,
	fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<DeliveryResult> {
	const to = (env.FEEDBACK_TO ?? "")
		.split(",")
		.map((address) => address.trim())
		.filter(Boolean);

	if (!env.RESEND_API_KEY || !env.FEEDBACK_FROM || to.length === 0) {
		return {
			status: "skipped",
			reason: "RESEND_API_KEY, FEEDBACK_FROM, or FEEDBACK_TO is not set",
		};
	}

	const { subject, text } = buildFeedbackEmail(feedback);
	return postJson(
		fetchImpl,
		RESEND_URL,
		{ from: env.FEEDBACK_FROM, to, subject, text },
		{ Authorization: `Bearer ${env.RESEND_API_KEY}` },
	);
}

/** Post the sanitized message to the Slack Incoming Webhook. Skips when not configured. */
export async function postFeedbackToSlack(
	env: FeedbackEnv,
	feedback: FeedbackRecord,
	fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<DeliveryResult> {
	if (!env.SLACK_FEEDBACK_WEBHOOK_URL) {
		return { status: "skipped", reason: "SLACK_FEEDBACK_WEBHOOK_URL is not set" };
	}

	return postJson(fetchImpl, env.SLACK_FEEDBACK_WEBHOOK_URL, buildSlackPayload(feedback));
}
