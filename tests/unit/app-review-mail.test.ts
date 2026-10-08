import { describe, expect, it } from "bun:test";
import { decisionMail, requestMail, sendMail } from "../../src/lib/app-review-mail.ts";

const app = {
	id: "my-app",
	name: "My App",
	description: "A study tool for small groups.",
	websiteUrl: "https://app.example",
	redirectUris: ["https://app.example/callback"],
	scopes: ["profile", "bookmarks"],
	ownerEmail: "dev@example.com",
};

describe("requestMail", () => {
	it("tells the admin who asks, for what, and where to decide", () => {
		const mail = requestMail(app, "new");
		expect(mail.subject).toBe("App to review: My App");
		for (const part of [
			"my-app",
			"dev@example.com",
			"A study tool for small groups.",
			"https://app.example/callback",
			"profile, bookmarks",
			"https://accounts.urantiahub.com/apps/admin",
		]) {
			expect(mail.text).toContain(part);
		}
	});

	it("says when an approved app changed and needs a new look", () => {
		expect(requestMail(app, "changed").subject).toBe("App changed, review again: My App");
	});

	// The text comes from a stranger. It goes out as plain text, and a new line cannot start a mail header.
	it("keeps a name with new lines on one line of the subject, and sends no HTML", () => {
		const mail = requestMail({ ...app, name: "Nice\r\nBcc: someone@evil.example" }, "new");
		expect(mail.subject).not.toMatch(/[\r\n]/);
		expect(mail).not.toHaveProperty("html");
	});

	it("cuts a very long description", () => {
		expect(requestMail({ ...app, description: "x".repeat(5000) }, "new").text.length).toBeLessThan(
			2500,
		);
	});
});

describe("decisionMail", () => {
	it("tells the developer the decision and the note", () => {
		const mail = decisionMail(app, "declined", "Please add a privacy page.");
		expect(mail.subject).toBe("Your app My App was declined");
		expect(mail.text).toContain("Please add a privacy page.");
		expect(mail.text).toContain("https://accounts.urantiahub.com/apps/my-app");
	});
	it("has a plain text for each decision, with or without a note", () => {
		expect(decisionMail(app, "approved", null).subject).toBe("Your app My App is approved");
		expect(decisionMail(app, "suspended", null).subject).toBe("Your app My App is suspended");
		expect(decisionMail(app, "approved", null).text).not.toContain("null");
	});
});

describe("sendMail", () => {
	const env = { RESEND_API_KEY: "key", FEEDBACK_FROM: "UrantiaHub <team@urantiahub.com>" };
	const mail = { subject: "s", text: "t" };

	it("sends through Resend, as plain text", async () => {
		const calls: Array<[string, RequestInit]> = [];
		const fetch = async (url: string, init: RequestInit) => {
			calls.push([url, init]);
			return new Response("{}", { status: 200 });
		};
		expect(await sendMail(env, "to@example.com", mail, fetch)).toBe(true);
		expect(calls[0]?.[0]).toBe("https://api.resend.com/emails");
		expect(JSON.parse(calls[0]?.[1].body as string)).toEqual({
			from: env.FEEDBACK_FROM,
			to: ["to@example.com"],
			subject: "s",
			text: "t",
		});
	});

	// A mail is a notice. A failure must never stop the request that caused it.
	it("answers false, and does not throw, with no key, no address, a refusal, or a failed request", async () => {
		const ok = async () => new Response("{}", { status: 200 });
		expect(await sendMail({}, "to@example.com", mail, ok)).toBe(false);
		expect(await sendMail(env, null, mail, ok)).toBe(false);
		expect(
			await sendMail(env, "to@example.com", mail, async () => new Response("no", { status: 500 })),
		).toBe(false);
		expect(
			await sendMail(env, "to@example.com", mail, async () => {
				throw new Error("down");
			}),
		).toBe(false);
	});
});
