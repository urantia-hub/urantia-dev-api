import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { handleSendEmail, sendHtmlMail } from "../../src/lib/mail/hook.ts";

const KEY = Buffer.from("a-test-key-of-thirty-two-bytes!!").toString("base64");
const SECRET = `v1,whsec_${KEY}`;
const NOW = new Date("2026-10-08T12:00:00Z");
const stamp = String(Math.floor(NOW.getTime() / 1000));

const payload = (over: Record<string, unknown> = {}) => ({
	user: { id: "u1", email: "reader@example.com" },
	email_data: {
		token: "481920",
		token_hash: "hash-1",
		redirect_to: "https://accounts.urantiahub.com/callback?app_id=voices&state=s1",
		email_action_type: "magiclink",
		site_url: "https://accounts.urantiahub.com",
		...over,
	},
});

function request(body: string, signed = true) {
	const mac = createHmac("sha256", Buffer.from(KEY, "base64"))
		.update(`msg_1.${stamp}.${body}`)
		.digest("base64");
	const all: Record<string, string> = {
		"webhook-id": "msg_1",
		"webhook-timestamp": stamp,
		"webhook-signature": signed ? `v1,${mac}` : "v1,AAAA",
	};
	return { body, header: (name: string) => all[name] };
}

function deps(over: { sent?: boolean; appName?: string | null } = {}) {
	const mails: Array<{ to: string; subject: string; html: string; text: string }> = [];
	const logs: string[] = [];
	return {
		mails,
		logs,
		deps: {
			secret: SECRET,
			now: NOW,
			appName: async (id: string) =>
				over.appName === undefined ? (id === "voices" ? "Our Paper Voices" : null) : over.appName,
			send: async (to: string, mail: { subject: string; html: string; text: string }) => {
				mails.push({ to, ...mail });
				return over.sent ?? true;
			},
			log: (message: string, fields?: Record<string, unknown>) =>
				logs.push(`${message} ${JSON.stringify(fields ?? {})}`),
		},
	};
}

describe("the Send Email hook", () => {
	it("sends the code and the link to the reader, and answers with an empty 200", async () => {
		const d = deps();
		const res = await handleSendEmail(request(JSON.stringify(payload())), d.deps);
		expect(res).toEqual({ status: 200, body: {} });
		expect(d.mails).toHaveLength(1);
		expect(d.mails[0]?.to).toBe("reader@example.com");
		expect(d.mails[0]?.subject).toBe("481920 is your UrantiaHub code");
		expect(d.mails[0]?.html).toContain("token_hash=hash-1");
		expect(d.mails[0]?.html).toContain("Our Paper Voices");
	});

	it("sends the same email to a new reader (signup)", async () => {
		const d = deps();
		await handleSendEmail(
			request(JSON.stringify(payload({ email_action_type: "signup" }))),
			d.deps,
		);
		expect(d.mails[0]?.subject).toBe("481920 is your UrantiaHub code");
	});

	it("names no app for the sign-in of UrantiaHub itself", async () => {
		const d = deps();
		await handleSendEmail(
			request(JSON.stringify(payload({ redirect_to: "https://accounts.urantiahub.com/callback" }))),
			d.deps,
		);
		expect(d.mails[0]?.html).not.toContain("You asked to sign in to");
	});

	it.each([
		["a bad signature", false],
	])("answers 401 and sends nothing for %s", async (_name, signed) => {
		const d = deps();
		const res = await handleSendEmail(request(JSON.stringify(payload()), signed), d.deps);
		expect(res.status).toBe(401);
		expect(d.mails).toHaveLength(0);
	});

	it("answers 401 when no secret is set: the hook is closed until it has one", async () => {
		const d = deps();
		const res = await handleSendEmail(request(JSON.stringify(payload())), {
			...d.deps,
			secret: undefined,
		});
		expect(res.status).toBe(401);
		expect(d.mails).toHaveLength(0);
	});

	it("answers 400 for a signed body that is not what Supabase sends", async () => {
		for (const body of ["not json", "{}", JSON.stringify({ user: {}, email_data: {} })]) {
			const d = deps();
			expect((await handleSendEmail(request(body), d.deps)).status).toBe(400);
			expect(d.mails).toHaveLength(0);
		}
	});

	// We use the email code only. Another kind of auth email must not go out with our words on it.
	it.each([
		"recovery",
		"invite",
		"email_change",
		"reauthentication",
		"anything",
	])("sends nothing for the kind %p, says so in the log, and answers 200", async (kind) => {
		const d = deps();
		const res = await handleSendEmail(
			request(JSON.stringify(payload({ email_action_type: kind }))),
			d.deps,
		);
		expect(res.status).toBe(200);
		expect(d.mails).toHaveLength(0);
		expect(d.logs.join("\n")).toContain("not sent");
	});

	// Supabase tells the sign-in page that the email failed, and the reader can try again.
	it("answers 500 when the email cannot be sent", async () => {
		const d = deps({ sent: false });
		const res = await handleSendEmail(request(JSON.stringify(payload())), d.deps);
		expect(res.status).toBe(500);
		expect(res.body).toEqual({ error: { http_code: 500, message: "The email was not sent." } });
	});

	it("answers 500 for a code that is not six digits, and sends nothing", async () => {
		const d = deps();
		const res = await handleSendEmail(
			request(JSON.stringify(payload({ token: "48192012" }))),
			d.deps,
		);
		expect(res.status).toBe(500);
		expect(d.mails).toHaveLength(0);
	});

	it("puts no email address, code, or proof in a log line", async () => {
		for (const over of [{}, { email_action_type: "recovery" }, { token: "x" }]) {
			const d = deps({ sent: false });
			await handleSendEmail(request(JSON.stringify(payload(over))), d.deps);
			const all = d.logs.join("\n");
			expect(all).not.toContain("reader@example.com");
			expect(all).not.toContain("481920");
			expect(all).not.toContain("hash-1");
		}
	});
});

describe("sendHtmlMail", () => {
	const mail = { subject: "S", html: "<p>h</p>", text: "t" };
	it("sends both parts through Resend, from the given sender", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const ok = await sendHtmlMail(
			{ RESEND_API_KEY: "re_test" },
			"UrantiaHub <signin@accounts.urantiahub.com>",
			"reader@example.com",
			mail,
			async (url, init) => {
				calls.push({ url, init });
				return new Response("{}", { status: 200 });
			},
		);
		expect(ok).toBe(true);
		expect(calls[0]?.url).toBe("https://api.resend.com/emails");
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			from: "UrantiaHub <signin@accounts.urantiahub.com>",
			to: ["reader@example.com"],
			subject: "S",
			html: "<p>h</p>",
			text: "t",
		});
		expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer re_test");
	});
	it("is false, and does not throw, with no key, for a refusal, and for a network error", async () => {
		expect(await sendHtmlMail({}, "a@b.c", "r@e.x", mail, async () => new Response("{}"))).toBe(
			false,
		);
		expect(
			await sendHtmlMail(
				{ RESEND_API_KEY: "k" },
				"a@b.c",
				"r@e.x",
				mail,
				async () => new Response("no", { status: 422 }),
			),
		).toBe(false);
		expect(
			await sendHtmlMail({ RESEND_API_KEY: "k" }, "a@b.c", "r@e.x", mail, async () => {
				throw new Error("down");
			}),
		).toBe(false);
	});
});
