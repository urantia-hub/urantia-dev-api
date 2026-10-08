import { beforeAll, describe, expect, it } from "bun:test";
import { decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
	ACCESS_TOKEN_SECONDS,
	type AppClaims,
	publicJwks,
	signAccessToken,
	type TokenEnv,
	verifyAccessToken,
} from "../../src/lib/app-tokens.ts";

const claims: AppClaims = {
	sub: "00000000-0000-4000-8000-000000000001",
	email: "reader@example.com",
	scopes: ["profile", "bookmarks"],
	app_id: "some-app",
};
const SECRET = "test-secret-for-app-tokens-0123456789";
const NOW = new Date("2026-10-08T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let env: TokenEnv;
let otherEnv: TokenEnv;

const makeKey = async () =>
	JSON.stringify(
		await exportJWK((await generateKeyPair("ES256", { extractable: true })).privateKey),
	);

beforeAll(async () => {
	env = { APP_JWT_PRIVATE_JWK: await makeKey() };
	otherEnv = { APP_JWT_PRIVATE_JWK: await makeKey() };
});

const hs256 = (overrides: Record<string, unknown> = {}, secret = SECRET) =>
	new SignJWT({ ...claims, ...overrides })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuer("https://accounts.urantiahub.com")
		.setAudience("authenticated")
		.setIssuedAt(Math.floor(NOW.getTime() / 1000))
		.setExpirationTime(Math.floor(later(60).getTime() / 1000))
		.sign(new TextEncoder().encode(secret));

describe("signAccessToken", () => {
	it("signs with ES256, for 15 minutes, with the key id in the header", async () => {
		const { token, expiresAt } = await signAccessToken(claims, env, NOW);
		const header = decodeProtectedHeader(token);
		const [key] = (await publicJwks(env)).keys;
		expect(header.alg).toBe("ES256");
		expect(header.kid).toBe(key?.kid as string);
		const payload = decodeJwt(token);
		expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(ACCESS_TOKEN_SECONDS);
		expect(ACCESS_TOKEN_SECONDS).toBe(900);
		expect(expiresAt.toISOString()).toBe("2026-10-08T12:15:00.000Z");
	});

	it("falls back to HS256 when no private key is set, so a deploy before the key is safe", async () => {
		const { token } = await signAccessToken(claims, { APP_JWT_SECRET: SECRET }, NOW);
		expect(decodeProtectedHeader(token).alg).toBe("HS256");
		const payload = decodeJwt(token);
		expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);
	});

	it("throws with no key at all", async () => {
		await expect(signAccessToken(claims, {}, NOW)).rejects.toThrow();
	});
});

// @urantia/auth 0.2.0 drops a session whose access token is past its end, and loses the refresh token with it.
// So the life stays long by a setting until each client has 0.3.0.
describe("the life of an access token", () => {
	const life = async (setting: string | undefined) => {
		const { token } = await signAccessToken(claims, { ...env, ACCESS_TOKEN_SECONDS: setting }, NOW);
		const payload = decodeJwt(token);
		return (payload.exp ?? 0) - (payload.iat ?? 0);
	};
	it("is 15 minutes with no setting", async () => expect(await life(undefined)).toBe(900));
	it("follows the setting", async () => expect(await life("604800")).toBe(604800));
	it("is 15 minutes for a setting that is not a number, or is too small", async () => {
		expect(await life("soon")).toBe(900);
		expect(await life("0")).toBe(900);
		expect(await life("-5")).toBe(900);
	});
	it("is never more than 7 days", async () => expect(await life("99999999")).toBe(604800));
});

describe("verifyAccessToken", () => {
	it("verifies its own token and returns the claims", async () => {
		const { token } = await signAccessToken(claims, env, NOW);
		expect(await verifyAccessToken(token, env, later(1))).toEqual(claims);
	});

	it("refuses a token after 15 minutes", async () => {
		const { token } = await signAccessToken(claims, env, NOW);
		await expect(verifyAccessToken(token, env, later(16))).rejects.toThrow();
	});

	it("refuses a token signed by another key", async () => {
		const { token } = await signAccessToken(claims, otherEnv, NOW);
		await expect(verifyAccessToken(token, env, later(1))).rejects.toThrow();
	});

	it("refuses a token with no signature", async () => {
		const body = btoa(
			JSON.stringify({
				...claims,
				iss: "https://accounts.urantiahub.com",
				aud: "authenticated",
				exp: Math.floor(later(5).getTime() / 1000),
			}),
		).replace(/=+$/, "");
		const token = `${btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "")}.${body}.`;
		await expect(verifyAccessToken(token, env, later(1))).rejects.toThrow();
	});

	// A known attack: sign with HS256 and use the public key text as the secret.
	it("refuses an HS256 token signed with the public key as the secret", async () => {
		const pub = JSON.stringify((await publicJwks(env)).keys[0]);
		const token = await hs256({}, pub);
		const withWindow = {
			...env,
			APP_JWT_SECRET: SECRET,
			HS256_ACCEPT_UNTIL: later(600).toISOString(),
		};
		await expect(verifyAccessToken(token, withWindow, later(1))).rejects.toThrow();
	});

	it("accepts an old HS256 token before HS256_ACCEPT_UNTIL, and refuses it after", async () => {
		const token = await hs256();
		const oldEnv = { ...env, APP_JWT_SECRET: SECRET, HS256_ACCEPT_UNTIL: later(30).toISOString() };
		expect(await verifyAccessToken(token, oldEnv, later(1))).toEqual(claims);
		await expect(verifyAccessToken(token, oldEnv, later(31))).rejects.toThrow();
	});

	it("accepts HS256 while no ES256 key is set, and refuses it with a key and no date", async () => {
		const token = await hs256();
		expect(await verifyAccessToken(token, { APP_JWT_SECRET: SECRET }, later(1))).toEqual(claims);
		await expect(
			verifyAccessToken(token, { ...env, APP_JWT_SECRET: SECRET }, later(1)),
		).rejects.toThrow();
		await expect(
			verifyAccessToken(
				token,
				{ ...env, APP_JWT_SECRET: SECRET, HS256_ACCEPT_UNTIL: "not a date" },
				later(1),
			),
		).rejects.toThrow();
	});

	it("refuses a token whose issuer or audience is not ours", async () => {
		const wrongIssuer = await new SignJWT({ ...claims })
			.setProtectedHeader({ alg: "HS256" })
			.setIssuer("https://evil.example")
			.setAudience("authenticated")
			.setExpirationTime(Math.floor(later(60).getTime() / 1000))
			.sign(new TextEncoder().encode(SECRET));
		await expect(
			verifyAccessToken(wrongIssuer, { APP_JWT_SECRET: SECRET }, later(1)),
		).rejects.toThrow();
	});

	it("refuses a token with no reader or no app, and drops scopes that are not text", async () => {
		await expect(
			verifyAccessToken(await hs256({ app_id: undefined }), { APP_JWT_SECRET: SECRET }, later(1)),
		).rejects.toThrow();
		const odd = await verifyAccessToken(
			await hs256({ scopes: ["notes", 7, null] }),
			{ APP_JWT_SECRET: SECRET },
			later(1),
		);
		expect(odd.scopes).toEqual(["notes"]);
		const none = await verifyAccessToken(
			await hs256({ scopes: "profile notes" }),
			{ APP_JWT_SECRET: SECRET },
			later(1),
		);
		expect(none.scopes).toEqual([]);
	});

	it("refuses text that is not a token", async () => {
		await expect(verifyAccessToken("not-a-token", env, NOW)).rejects.toThrow();
	});
});

describe("publicJwks", () => {
	it("never returns the private part", async () => {
		const [key] = (await publicJwks(env)).keys;
		expect(key).not.toHaveProperty("d");
		expect(key).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
	});

	it("is an empty list with no key", async () => {
		expect(await publicJwks({})).toEqual({ keys: [] });
	});
});

// The message of a JSON error quotes the text that it could not read. Here that text is the private key,
// and the middleware logs the message of a failed check.
describe("a private key setting that is not valid JSON", () => {
	const broken = { APP_JWT_PRIVATE_JWK: '{"kty":"EC","d":"SECRET-PART-OF-THE-KEY' };
	const messageOf = async (run: () => Promise<unknown>) => {
		try {
			await run();
			return "no error";
		} catch (err) {
			return `${(err as Error).message} ${String((err as Error).cause ?? "")} ${(err as Error).stack ?? ""}`;
		}
	};

	it("gives an error with no part of the key, for sign, verify, and the key file", async () => {
		const good = await signAccessToken(claims, env, NOW);
		for (const run of [
			() => signAccessToken(claims, broken, NOW),
			() => verifyAccessToken(good.token, broken, NOW),
			() => publicJwks(broken),
		]) {
			const message = await messageOf(run);
			expect(message).not.toBe("no error");
			// Bun's JSON error does not quote the text, but the Workers runtime (V8) does. So check our own message.
			expect(message).toContain("The signing key setting is not valid JSON.");
			expect(message).not.toContain("SECRET-PART");
			expect(message).not.toContain('"d"');
		}
	});
});
