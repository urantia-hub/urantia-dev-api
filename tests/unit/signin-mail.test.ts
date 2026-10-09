import { describe, expect, it } from "bun:test";
import { requestOf, signInLink, signInMail } from "../../src/lib/mail/signin.ts";

const CALLBACK =
	"https://accounts.urantiahub.com/callback?app_id=voices&redirect_uri=https%3A%2F%2Fv.example%2Fcb&state=s1";

describe("the sign-in email", () => {
	const mail = signInMail({
		code: "481920",
		link: "https://accounts.urantiahub.com/callback?token_hash=abc&type=email",
		appName: "Our Paper Voices",
	});

	it("has the code in the subject, so a reader sees it in the list of the inbox", () => {
		expect(mail.subject).toBe("481920 is your UrantiaHub code");
	});

	it("has the code, how long it works, and the link, as HTML and as text", () => {
		for (const part of [mail.html, mail.text]) {
			expect(part).toContain("481920");
			expect(part).toContain("It works for 10 minutes.");
			expect(part).toContain("token_hash=abc");
			expect(part).toContain("If you did not ask for this, you can ignore this email.");
			expect(part).toContain("team@urantiahub.com");
		}
		expect(mail.html).toContain("Or sign in with this link");
	});

	it("names the app that the reader signs in to", () => {
		expect(mail.html).toContain("You asked to sign in to <b>Our Paper Voices</b>.");
		expect(mail.text).toContain("You asked to sign in to Our Paper Voices.");
	});

	it("has no line about an app for UrantiaHub itself, or for an app that is not known", () => {
		const own = signInMail({ code: "481920", link: "https://x/y", appName: null });
		expect(own.html).not.toContain("You asked to sign in to");
		expect(own.text).not.toContain("You asked to sign in to");
	});

	// The name of an app is a stranger's words.
	it("shows the name of an app as text", () => {
		const odd = signInMail({
			code: "481920",
			link: "https://x/y",
			appName: '<script>alert(1)</script> & "Co"',
		});
		expect(odd.html).not.toContain("<script>");
		expect(odd.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;");
	});

	it("has no script, no remote image, and never the plain name Urantia", () => {
		expect(mail.html).not.toMatch(/<script|<img|javascript:/i);
		expect(
			`${mail.subject} ${mail.text}`.replace(/UrantiaHub/gi, "").replace(/urantiahub\.com/gi, ""),
		).not.toMatch(/urantia/i);
	});

	it("refuses a code that is not six digits: nothing else goes into a subject", () => {
		expect(() => signInMail({ code: "48192", link: "https://x/y", appName: null })).toThrow();
		expect(() =>
			signInMail({ code: "481920\nBcc: x@evil.example", link: "https://x/y", appName: null }),
		).toThrow();
	});
});

describe("the link in the email", () => {
	it("is our own callback with the proof on it, and the request of the app kept", () => {
		const link = new URL(signInLink(CALLBACK, "hash-1"));
		expect(link.origin + link.pathname).toBe("https://accounts.urantiahub.com/callback");
		expect(link.searchParams.get("token_hash")).toBe("hash-1");
		expect(link.searchParams.get("type")).toBe("email");
		expect(link.searchParams.get("app_id")).toBe("voices");
		expect(link.searchParams.get("state")).toBe("s1");
	});

	// redirect_to comes with the request for the email. The proof must never go to another site.
	it("never sends the proof to another site, or to another path", () => {
		for (const to of [
			"https://evil.example/callback",
			"https://accounts.urantiahub.com.evil.example/callback",
			"https://accounts.urantiahub.com/other",
			"http://accounts.urantiahub.com/callback",
			"not a url",
			"",
			undefined,
		]) {
			expect(signInLink(to, "hash-1")).toBe(
				"https://accounts.urantiahub.com/callback?token_hash=hash-1&type=email",
			);
		}
	});

	it("does not keep a proof or a type that came with the address", () => {
		const link = new URL(signInLink(`${CALLBACK}&token_hash=old&type=recovery`, "hash-1"));
		expect(link.searchParams.getAll("token_hash")).toEqual(["hash-1"]);
		expect(link.searchParams.getAll("type")).toEqual(["email"]);
	});

	it("gives the app that the reader signs in to, or nothing", () => {
		expect(requestOf(CALLBACK)).toBe("voices");
		expect(requestOf("https://accounts.urantiahub.com/callback")).toBeNull();
		expect(requestOf("https://evil.example/callback?app_id=voices")).toBeNull();
		expect(requestOf(undefined)).toBeNull();
	});
});
