import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { app } from "../../src/index.ts";
import { signAccessToken } from "../../src/lib/app-tokens.ts";

// These requests stop in the auth middleware, before the database. So they are safe with any .env.
const SECRET = "test-secret-for-app-tokens-0123456789";
const saved = { secret: process.env.APP_JWT_SECRET, supabase: process.env.SUPABASE_URL };

beforeAll(() => {
	process.env.APP_JWT_SECRET = SECRET;
	// Nothing listens here, so the check against the Supabase keys fails at once.
	process.env.SUPABASE_URL = "http://127.0.0.1:9";
});
// A value of "undefined" is not the same as no value: a runtime can store it as the text "undefined".
function restore(name: string, value: string | undefined) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}
afterAll(() => {
	restore("APP_JWT_SECRET", saved.secret);
	restore("SUPABASE_URL", saved.supabase);
});

const appToken = (claims: Record<string, unknown>) =>
	new SignJWT({
		sub: "00000000-0000-4000-8000-000000000001",
		email: null,
		app_id: "some-app",
		iss: "https://accounts.urantiahub.com",
		aud: "authenticated",
		...claims,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(new TextEncoder().encode(SECRET));

const call = async (path: string, token: string, method = "GET") =>
	app.request(path, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			"cf-connecting-ip": "token-access-test",
			"content-type": "application/json",
		},
		body: method === "GET" ? undefined : "{}",
	});

describe("a token of an app", () => {
	it("cannot read bookmarks with the profile scope only", async () => {
		const res = await call("/me/bookmarks", await appToken({ scopes: ["profile"] }));
		expect(res.status).toBe(403);
		expect(((await res.json()) as { detail: string }).detail).toContain('"bookmarks"');
	});

	it("cannot write a note with the bookmarks scope", async () => {
		expect(
			(await call("/me/notes", await appToken({ scopes: ["bookmarks"] }), "POST")).status,
		).toBe(403);
	});

	it("cannot reach anything with no scopes claim", async () => {
		expect((await call("/me", await appToken({}))).status).toBe(403);
		expect((await call("/me", await appToken({ scopes: "profile bookmarks" }))).status).toBe(403);
	});

	// The token and refresh routes take no sign-in. An app that also sends its token must not get a 403 there.
	it("can still exchange a code and refresh", async () => {
		const token = await appToken({ scopes: ["profile"] });
		expect((await call("/auth/token", token, "POST")).status).toBe(400);
		expect((await call("/auth/refresh", token, "POST")).status).toBe(400);
		expect((await call("/auth/revoke", token, "POST")).status).toBe(400);
	});

	it("cannot change an app, or rotate its secret", async () => {
		const token = await appToken({ scopes: ["profile"] });
		for (const method of ["PATCH", "DELETE"])
			expect((await call("/auth/apps/some-app", token, method)).status).toBe(403);
		expect((await call("/auth/apps/some-app/rotate-secret", token, "POST")).status).toBe(403);
	});

	it("cannot issue a code, list apps, or register an app", async () => {
		const token = await appToken({
			scopes: ["profile", "bookmarks", "notes", "reading-progress", "preferences", "app-data"],
		});
		expect((await call("/auth/authorize", token, "POST")).status).toBe(403);
		expect((await call("/auth/apps", token)).status).toBe(403);
		expect((await call("/auth/apps", token, "POST")).status).toBe(403);
	});
});

describe("a token of an app, away from /me", () => {
	// The admin routes know an admin by the user id. A token that an app holds for an admin must not be that admin.
	it("is not a sign-in on the admin routes", async () => {
		const token = await appToken({
			scopes: ["profile", "bookmarks", "notes", "reading-progress", "preferences", "app-data"],
		});
		const withToken = await call("/admin/stats", token);
		const bare = await app.request("/admin/stats", {
			headers: { "cf-connecting-ip": "token-access-test" },
		});
		expect(withToken.status).toBe(bare.status);
		expect([401, 403, 404]).toContain(withToken.status);
	});

	it("cannot change the profile with the profile scope", async () => {
		expect((await call("/me", await appToken({ scopes: ["profile"] }), "PUT")).status).toBe(403);
	});
});

describe("a request with no token", () => {
	const bare = (path: string, method: string) =>
		app.request(path, {
			method,
			headers: { "cf-connecting-ip": "token-access-test", "content-type": "application/json" },
			body: "{}",
		});

	// Only the public record of an app takes no sign-in. A change to an app answered 500 before.
	it("gets 401 for a change to an app", async () => {
		expect((await bare("/auth/apps/some-app", "PATCH")).status).toBe(401);
		expect((await bare("/auth/apps/some-app", "DELETE")).status).toBe(401);
		expect((await bare("/auth/apps/some-app/rotate-secret", "POST")).status).toBe(401);
		expect((await bare("/auth/apps/some-app/logo", "POST")).status).toBe(401);
	});
});

// A logo is an image on the sign-in page, which a visitor with no sign-in sees.
describe("a logo file", () => {
	const get = (path: string) =>
		app.request(path, { headers: { "cf-connecting-ip": "token-access-test" } });
	it("needs no sign-in", async () => {
		const res = await get("/auth/apps/some-app/logo/3f2c1e52-77ab-4d0e-9c21-5b6f0a4d91e7.png");
		// 404: there is no file store in this test. 401 would mean that the route asks for a sign-in.
		expect(res.status).toBe(404);
	});
	it("opens nothing else under that path", async () => {
		expect((await get("/auth/apps/some-app/logo/x/y")).status).toBe(401);
		expect((await get("/auth/apps/some-app/change/x")).status).toBe(401);
	});
});

// Supabase signs each call of the Send Email hook. Without a good signature nothing is sent.
describe("the Send Email hook", () => {
	const post = (headers: Record<string, string> = {}) =>
		app.request("/hooks/send-email", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"cf-connecting-ip": "token-access-test",
				...headers,
			},
			body: JSON.stringify({
				user: { email: "reader@example.com" },
				email_data: { token: "481920", token_hash: "h", email_action_type: "magiclink" },
			}),
		});
	it("refuses a call with no signature, and one with a made-up signature", async () => {
		expect((await post()).status).toBe(401);
		const res = await post({
			"webhook-id": "msg_1",
			"webhook-timestamp": String(Math.floor(Date.now() / 1000)),
			"webhook-signature": "v1,AAAA",
		});
		expect(res.status).toBe(401);
		expect(((await res.json()) as { error: { http_code: number } }).error.http_code).toBe(401);
	});
	// The call has no sign-in, so its size is checked as it is read, before anything else.
	it("refuses a body that is too large, with or without a length header", async () => {
		const big = "x".repeat(40_000);
		const headers = { "content-type": "application/json", "cf-connecting-ip": "token-access-test" };
		expect(
			(await app.request("/hooks/send-email", { method: "POST", headers, body: big })).status,
		).toBe(413);
		const lied = await app.request("/hooks/send-email", {
			method: "POST",
			headers: { ...headers, "content-length": "10" },
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(big));
					controller.close();
				},
			}),
			duplex: "half",
		});
		expect(lied.status).toBe(413);
	});
	it("is not in the public spec", async () => {
		const spec = (await (await app.request("/openapi.json")).json()) as {
			paths: Record<string, unknown>;
		};
		expect(Object.keys(spec.paths).filter((path) => path.startsWith("/hooks"))).toEqual([]);
	});
});

describe("the path rule", () => {
	// "/meaning" starts with "/me" but is not under it.
	it("does not treat a path that only starts with /me as a signed-in route", async () => {
		const res = await app.request("/meaning", {
			headers: { "cf-connecting-ip": "token-access-test" },
		});
		expect(res.status).not.toBe(401);
	});
});

describe("a database that is down", () => {
	// 401 tells a client to sign the reader out. An outage must not do that.
	// This file runs with no database, so the lookup of the reader fails.
	it("answers 503, not 401, for a good token", async () => {
		const saved = process.env.DATABASE_URL;
		process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:9/none";
		try {
			const res = await call("/me/bookmarks", await appToken({ scopes: ["bookmarks"] }));
			expect(res.status).toBe(503);
			expect(res.headers.get("retry-after")).toBe("5");
		} finally {
			restore("DATABASE_URL", saved);
		}
	});

	it("still answers 401 for a token that is not good", async () => {
		expect((await call("/me/bookmarks", "not-a-token")).status).toBe(401);
	});
});

describe("a token signed with the new key", () => {
	const reader = { sub: "00000000-0000-4000-8000-000000000001", email: null, app_id: "some-app" };

	it("is checked by the middleware: the scope rule applies to it", async () => {
		const saved = process.env.APP_JWT_PRIVATE_JWK;
		const { privateKey } = await generateKeyPair("ES256", { extractable: true });
		process.env.APP_JWT_PRIVATE_JWK = JSON.stringify(await exportJWK(privateKey));
		try {
			const env = { APP_JWT_PRIVATE_JWK: process.env.APP_JWT_PRIVATE_JWK };
			const { token } = await signAccessToken({ ...reader, scopes: ["profile"] }, env);
			// 403 proves that the token was accepted and its scopes were read. A bad token gets 401.
			expect((await call("/me/bookmarks", token)).status).toBe(403);
			// With the key in place and no date for old tokens, an HS256 token is refused.
			expect((await call("/me/bookmarks", await appToken({ scopes: ["profile"] }))).status).toBe(
				401,
			);
		} finally {
			restore("APP_JWT_PRIVATE_JWK", saved);
		}
	});
});

// The account routes act for the reader on the accounts site. No app can call them.
describe("the routes of the accounts site", () => {
	const routes: Array<[method: string, path: string]> = [
		["GET", "/auth/consents"],
		["DELETE", "/auth/consents/some-app"],
		["DELETE", "/auth/account"],
		// A change request: only its developer withdraws it, and only an admin decides.
		["DELETE", "/auth/apps/some-app/change/req-1"],
		["POST", "/auth/apps/some-app/change/req-1/decision"],
		["PATCH", "/auth/apps/some-app/status"],
	];
	it.each(routes)("%s %s refuses a token of an app, with each scope", async (method, path) => {
		const token = await appToken({
			scopes: ["profile", "bookmarks", "notes", "reading-progress", "preferences", "app-data"],
		});
		expect((await call(path, token, method)).status).toBe(403);
	});
	it.each(routes)("%s %s needs a sign-in", async (method, path) => {
		const res = await app.request(path, {
			method,
			headers: { "cf-connecting-ip": "token-access-test" },
		});
		expect(res.status).toBe(401);
	});
});
