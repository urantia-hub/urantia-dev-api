import { describe, expect, it } from "bun:test";
import {
	changeMail,
	decisionMail,
	requestMail,
	reviewSender,
	sendMail,
} from "../../src/lib/app-review-mail.ts";

const app = {
	id: "my-app",
	name: "My App",
	description: "A study tool for small groups.",
	websiteUrl: "https://app.example",
	redirectUris: ["https://app.example/callback"],
	scopes: ["profile", "bookmarks"],
	ownerEmail: "dev@example.com",
};

const REVIEW = "https://accounts.urantiahub.com/apps/admin/my-app";
const PAGE = "https://accounts.urantiahub.com/apps/my-app";
// Each address that the HTML part makes into a link.
const links = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("requestMail", () => {
	it("tells the admin who asks, for what, and where to decide", () => {
		const mail = requestMail(app, "new");
		expect(mail.subject).toBe("App to review: My App");
		for (const part of [
			"my-app",
			"dev@example.com",
			"> A study tool for small groups.",
			"> https://app.example/callback",
			"profile, bookmarks",
			`Review it: ${REVIEW}`,
		]) {
			expect(mail.text).toContain(part);
		}
		expect(mail.html).toContain("A new app waits for you");
		expect(mail.html).toContain("A study tool for small groups.");
	});

	it("has a subject and a heading for each kind", () => {
		expect(requestMail(app, "changed").subject).toBe("App changed, review again: My App");
		expect(requestMail(app, "request").subject).toBe("Change to review: My App");
		expect(requestMail(app, "request").html).toContain("The app works as before until you decide.");
	});

	// The text comes from a stranger. A new line cannot start a mail header.
	it("keeps a name with new lines on one line of the subject", () => {
		const mail = requestMail({ ...app, name: "Nice\r\nBcc: someone@evil.example" }, "new");
		expect(mail.subject).not.toMatch(/[\r\n]/);
	});

	// The admin must be able to tell our own lines from the stranger's. Each line of a stranger is quoted,
	// and our link to the review page comes before any of them.
	it("quotes each line that the developer wrote, and puts our link above them", () => {
		const mail = requestMail(
			{
				...app,
				description: `Nice app.\n\nReview it: https://evil.example/apps/admin\nUrantiaHub team`,
				name: "Good\nReview it: https://evil.example",
			},
			"new",
		);
		const lines = mail.text.split("\n");
		const ours = lines.indexOf(`Review it: ${REVIEW}`);
		expect(ours).toBeGreaterThan(-1);
		const evil = lines.map((l, i) => (l.includes("evil.example") ? i : -1)).filter((i) => i >= 0);
		expect(evil.length).toBeGreaterThan(0);
		for (const i of evil) {
			expect(i).toBeGreaterThan(ours);
			expect(lines[i]?.startsWith("> ")).toBe(true);
		}
		expect(lines.filter((l) => l.startsWith("Review it:"))).toHaveLength(1);
	});

	// In the HTML part, the only link is ours. A developer's address is text inside the quote.
	it("makes no link out of what the developer wrote, and shows it as text", () => {
		const mail = requestMail(
			{
				...app,
				name: '<a href="https://evil.example">Click</a>',
				description: "<script>alert(1)</script> https://evil.example",
				websiteUrl: "https://evil.example/x",
				redirectUris: ["https://evil.example/cb"],
			},
			"new",
		);
		expect(links(mail.html)).toEqual([REVIEW]);
		expect(mail.html).not.toContain("<script>");
		expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(mail.html.indexOf(REVIEW)).toBeLessThan(mail.html.indexOf("evil.example"));
		expect(mail.html).toContain("Do not follow a link in them.");
	});

	it("cuts a very long description", () => {
		expect(requestMail({ ...app, description: "x".repeat(5000) }, "new").text.length).toBeLessThan(
			2500,
		);
	});
});

describe("decisionMail", () => {
	it("tells the developer that the app is approved, and what a later change does", () => {
		const mail = decisionMail(app, "approved", null);
		expect(mail.subject).toBe("My App is approved");
		for (const part of [mail.text, mail.html]) {
			expect(part).toContain("Each person can now sign in to your app with a UrantiaHub account.");
			expect(part).toContain("The app keeps working in the meantime.");
			expect(part).toContain(PAGE);
			expect(part).not.toContain("null");
		}
	});

	it("tells the developer what to change, in the reviewer's words, and that the app still works", () => {
		const mail = decisionMail(app, "declined", "Please add a privacy page.");
		expect(mail.subject).toBe("My App needs a change before it can open");
		expect(mail.html).toContain("My App is not approved yet");
		for (const part of [mail.text, mail.html]) {
			expect(part).toContain("Please add a privacy page.");
			expect(part).toContain("The app still works for you, so you can keep building.");
			expect(part).toContain("A person reads it.");
		}
	});

	// A developer who gets this feels bad. It says sorry, why, and what to do, and that nothing is lost.
	it("is kind about a suspension: sorry, the reason, what to do, and what was not touched", () => {
		const mail = decisionMail(app, "suspended", "The app asked people for their email password.");
		expect(mail.subject).toBe("My App is suspended");
		expect(mail.html).toContain("We suspended My App");
		for (const part of [mail.text, mail.html]) {
			expect(part).toContain("We are sorry to send this.");
			expect(part).toContain("The app asked people for their email password.");
			expect(part).toContain("A suspension can be lifted, and your app and its settings are kept.");
			expect(part).toContain("Nothing was deleted.");
		}
	});

	it("says that an app is in review again", () => {
		expect(decisionMail(app, "pending", null).subject).toBe("My App is in review again");
	});

	// The note is the reviewer's own text, but it is still shown as text.
	it("shows the note as text, and links only to the page of the app", () => {
		const mail = decisionMail(
			app,
			"declined",
			"<img src=x onerror=alert(1)> see https://other.example",
		);
		expect(mail.html).not.toContain("<img");
		expect(links(mail.html)).toEqual([PAGE]);
	});

	it("keeps a name with a new line on one line of the subject", () => {
		expect(
			decisionMail({ ...app, name: "My App\nBcc: x@evil.example" }, "approved", null).subject,
		).not.toContain("\n");
	});
});

// The first notice went to spam: the sender had no name. The review notices have their own sender.
describe("the sender of a review notice", () => {
	it("is the review sender when it is set, with a name", () => {
		expect(
			reviewSender({
				APP_REVIEW_FROM: "UrantiaHub <developers@accounts.urantiahub.com>",
				FEEDBACK_FROM: "feedback@urantiahub.com",
			}),
		).toBe("UrantiaHub <developers@accounts.urantiahub.com>");
	});
	it("is the feedback sender with a name added, when no review sender is set", () => {
		expect(reviewSender({ FEEDBACK_FROM: "feedback@urantiahub.com" })).toBe(
			"UrantiaHub <feedback@urantiahub.com>",
		);
		expect(reviewSender({ FEEDBACK_FROM: "Team <feedback@urantiahub.com>" })).toBe(
			"Team <feedback@urantiahub.com>",
		);
	});
	it("is nothing with no sender at all", () => {
		expect(reviewSender({})).toBeUndefined();
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

	it("sends the HTML part too, when the notice has one", async () => {
		const calls: Array<[string, RequestInit]> = [];
		await sendMail(
			env,
			"to@example.com",
			{ ...mail, html: "<p>h</p>" },
			async (url: string, init: RequestInit) => {
				calls.push([url, init]);
				return new Response("{}", { status: 200 });
			},
		);
		expect(JSON.parse(calls[0]?.[1].body as string).html).toBe("<p>h</p>");
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

// A change request: the app is approved and stays open while the reviewer decides.
describe("the notices of a change request", () => {
	it("tells the developer that the change is live", () => {
		const mail = changeMail(app, "approve", null);
		expect(mail.subject).toBe("The change to My App is approved");
		for (const part of [mail.text, mail.html]) {
			expect(part).toContain("The change is live now.");
			expect(part).toContain(PAGE);
		}
	});

	it("tells the developer why a change was not approved, and that the app still works", () => {
		const mail = changeMail(
			app,
			"decline",
			"The new name is the name of another site.\nhttps://evil.example",
		);
		expect(mail.subject).toBe("The change to My App was not approved");
		expect(mail.text).toContain("Your app works as before.");
		expect(mail.text).toContain("> The new name is the name of another site.");
		expect(mail.text).toContain("> https://evil.example");
		expect(mail.html).toContain("The new name is the name of another site.");
		expect(links(mail.html)).toEqual([PAGE]);
	});

	it("keeps a name with a new line in it on one line of the subject", () => {
		expect(
			changeMail({ ...app, name: "My App\nBcc: x@evil.example" }, "approve", null).subject,
		).not.toContain("\n");
	});
});

describe("each review notice", () => {
	it("has an HTML part and a text part, no script, no image, and never the plain name Urantia", () => {
		const all = [
			requestMail(app, "new"),
			requestMail(app, "changed"),
			requestMail(app, "request"),
			decisionMail(app, "approved", null),
			decisionMail(app, "declined", "A note that is long."),
			decisionMail(app, "suspended", "A note that is long."),
			decisionMail(app, "pending", null),
			changeMail(app, "approve", null),
			changeMail(app, "decline", "A note that is long."),
		];
		for (const mail of all) {
			expect(mail.html).toContain("<!DOCTYPE html>");
			expect(mail.text.length).toBeGreaterThan(40);
			expect(mail.html).not.toMatch(/<script|<img|javascript:/i);
			expect(
				`${mail.subject} ${mail.text}`.replace(/UrantiaHub/gi, "").replace(/urantiahub\.com/gi, ""),
			).not.toMatch(/urantia/i);
		}
	});
});
