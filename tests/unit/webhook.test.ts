import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../../src/lib/webhook.ts";

// The check of a Standard Webhooks signature, as Supabase signs its auth hooks.
const KEY = Buffer.from("a-test-key-of-thirty-two-bytes!!").toString("base64");
const SECRET = `v1,whsec_${KEY}`;
const NOW = new Date("2026-10-08T12:00:00Z");
const BODY = '{"user":{"email":"reader@example.com"}}';

// Made here with another library than the code under test.
function sign(id: string, seconds: number, body: string, key = KEY): string {
	const mac = createHmac("sha256", Buffer.from(key, "base64"))
		.update(`${id}.${seconds}.${body}`)
		.digest("base64");
	return `v1,${mac}`;
}
const stamp = Math.floor(NOW.getTime() / 1000);
const headers = (over: Record<string, string | undefined> = {}) => {
	const all: Record<string, string | undefined> = {
		"webhook-id": "msg_1",
		"webhook-timestamp": String(stamp),
		"webhook-signature": sign("msg_1", stamp, BODY),
		...over,
	};
	return (name: string) => all[name];
};

describe("verifyWebhook", () => {
	it("accepts a request that Supabase signed", async () => {
		expect(await verifyWebhook(SECRET, headers(), BODY, NOW)).toBe(true);
	});

	it("accepts the secret with or without its prefix, and one of several signatures", async () => {
		expect(await verifyWebhook(`whsec_${KEY}`, headers(), BODY, NOW)).toBe(true);
		expect(await verifyWebhook(KEY, headers(), BODY, NOW)).toBe(true);
		const two = `v1,AAAA ${sign("msg_1", stamp, BODY)}`;
		expect(await verifyWebhook(SECRET, headers({ "webhook-signature": two }), BODY, NOW)).toBe(
			true,
		);
	});

	it("refuses another body, another id, or another key", async () => {
		expect(await verifyWebhook(SECRET, headers(), `${BODY} `, NOW)).toBe(false);
		expect(await verifyWebhook(SECRET, headers({ "webhook-id": "msg_2" }), BODY, NOW)).toBe(false);
		const other = Buffer.from("another-key-of-thirty-two-bytes!").toString("base64");
		expect(
			await verifyWebhook(
				SECRET,
				headers({ "webhook-signature": sign("msg_1", stamp, BODY, other) }),
				BODY,
				NOW,
			),
		).toBe(false);
	});

	it("refuses a request with a header that is absent or empty", async () => {
		for (const name of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
			expect(await verifyWebhook(SECRET, headers({ [name]: undefined }), BODY, NOW)).toBe(false);
			expect(await verifyWebhook(SECRET, headers({ [name]: "" }), BODY, NOW)).toBe(false);
		}
	});

	// A request that someone recorded must not work later.
	it("refuses a request that is more than 5 minutes old, or from the future", async () => {
		for (const seconds of [stamp - 301, stamp + 301]) {
			const h = headers({
				"webhook-timestamp": String(seconds),
				"webhook-signature": sign("msg_1", seconds, BODY),
			});
			expect(await verifyWebhook(SECRET, h, BODY, NOW)).toBe(false);
		}
		const edge = headers({
			"webhook-timestamp": String(stamp - 299),
			"webhook-signature": sign("msg_1", stamp - 299, BODY),
		});
		expect(await verifyWebhook(SECRET, edge, BODY, NOW)).toBe(true);
	});

	it("refuses a time that is not a number, and a signature of another version", async () => {
		expect(await verifyWebhook(SECRET, headers({ "webhook-timestamp": "now" }), BODY, NOW)).toBe(
			false,
		);
		const v2 = sign("msg_1", stamp, BODY).replace("v1,", "v2,");
		expect(await verifyWebhook(SECRET, headers({ "webhook-signature": v2 }), BODY, NOW)).toBe(
			false,
		);
	});

	it("refuses everything when no secret is set", async () => {
		expect(await verifyWebhook("", headers(), BODY, NOW)).toBe(false);
		expect(await verifyWebhook(undefined, headers(), BODY, NOW)).toBe(false);
	});
});
