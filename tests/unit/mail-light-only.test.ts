import { describe, expect, it } from "bun:test";
import { requestMail } from "../../src/lib/app-review-mail.ts";
import { signInMail } from "../../src/lib/mail/signin.ts";

// A mail app with a dark theme can change the colors. The email asks for light only, and its
// button has an edge, so it stays a button in an app that does not obey (Kelson, 2026-10-13).
const app = {
	id: "my-app",
	name: "My App",
	description: "A study tool.",
	websiteUrl: "https://app.example",
	redirectUris: ["https://app.example/callback"],
	scopes: ["profile"],
	ownerEmail: "dev@example.com",
};

const mails = {
	"sign-in": signInMail({
		code: "481920",
		link: "https://accounts.urantiahub.com/login/link?token_hash=abc",
		appName: null,
	}).html,
	review: requestMail(app, "new").html,
};

describe("each email in a dark mail app", () => {
	for (const [name, html] of Object.entries(mails)) {
		it(`asks for light only: ${name}`, () => {
			expect(html).toContain('<meta name="color-scheme" content="light only">');
			expect(html).toContain('<meta name="supported-color-schemes" content="light only">');
			expect(html).toContain("color-scheme:light only");
		});

		it(`gives each button an edge: ${name}`, () => {
			const buttons = [...html.matchAll(/<a [^>]*style="([^"]*display:inline-block[^"]*)"/g)].map(
				(m) => m[1],
			);
			expect(buttons.length).toBeGreaterThan(0);
			for (const style of buttons) expect(style).toContain("border:1px solid #8d8676");
		});
	}
});
