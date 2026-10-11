import {
	calculateJwkThumbprint,
	decodeProtectedHeader,
	importJWK,
	type JWK,
	type JWTPayload,
	jwtVerify,
	SignJWT,
} from "jose";

// The access token that an app holds for a reader. It is short-lived, and it is signed with a private key
// that only this API has. Anyone can check it with the public key, which the accounts site publishes.

export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_MS = 90 * 24 * 60 * 60 * 1000;

const MAX_ACCESS_TOKEN_SECONDS = 7 * 24 * 60 * 60;

function accessTokenSeconds(env: TokenEnv): number {
	const seconds = Number(env.ACCESS_TOKEN_SECONDS);
	if (!Number.isInteger(seconds) || seconds < 60) return ACCESS_TOKEN_SECONDS;
	return Math.min(seconds, MAX_ACCESS_TOKEN_SECONDS);
}

const ISSUER = "https://accounts.urantiahub.com";
const AUDIENCE = "authenticated";

export type TokenEnv = {
	// The ES256 private key, as a JWK in JSON. A secret.
	APP_JWT_PRIVATE_JWK?: string;
	// The life of an access token in seconds. Absent means 15 minutes. Never more than 7 days.
	ACCESS_TOKEN_SECONDS?: string;
};

export type AppClaims = { sub: string; email: string | null; scopes: string[]; app_id: string };

type PublicKey = {
	kty: "EC";
	crv: string;
	x: string;
	y: string;
	kid: string;
	alg: "ES256";
	use: "sig";
};

function privateJwk(env: TokenEnv): JWK | null {
	if (!env.APP_JWT_PRIVATE_JWK) return null;
	let jwk: unknown;
	try {
		jwk = JSON.parse(env.APP_JWT_PRIVATE_JWK);
	} catch {
		// The message of a JSON error quotes the text, and this text is the private key. Drop that error.
		throw new Error("The signing key setting is not valid JSON.");
	}
	if (typeof jwk !== "object" || jwk === null) {
		throw new Error("The signing key setting is not a key.");
	}
	return jwk as JWK;
}

async function publicKey(env: TokenEnv): Promise<PublicKey | null> {
	const jwk = privateJwk(env);
	if (!jwk?.x || !jwk.y || !jwk.crv) return null;
	// Only the public fields are copied. The private part ("d") never leaves this function.
	const pub = { kty: "EC" as const, crv: jwk.crv, x: jwk.x, y: jwk.y };
	return { ...pub, kid: await calculateJwkThumbprint(pub), alg: "ES256", use: "sig" };
}

// The public keys, in the form of a key file. A list, so a key change can serve two keys for a time.
export async function publicJwks(env: TokenEnv): Promise<{ keys: PublicKey[] }> {
	const key = await publicKey(env);
	return { keys: key ? [key] : [] };
}

export async function signAccessToken(
	claims: AppClaims,
	env: TokenEnv,
	now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
	const issuedAt = Math.floor(now.getTime() / 1000);
	const life = accessTokenSeconds(env);
	const expiresAt = new Date((issuedAt + life) * 1000);
	const jwt = new SignJWT({ ...claims })
		.setIssuer(ISSUER)
		.setAudience(AUDIENCE)
		.setIssuedAt(issuedAt)
		.setExpirationTime(issuedAt + life);

	const jwk = privateJwk(env);
	const pub = await publicKey(env);
	if (!jwk || !pub) throw new Error("No signing key is set.");
	const token = await jwt
		.setProtectedHeader({ alg: "ES256", kid: pub.kid })
		.sign(await importJWK(jwk, "ES256"));
	return { token, expiresAt };
}

// Returns the claims of a good token. Throws for each other token.
export async function verifyAccessToken(
	token: string,
	env: TokenEnv,
	now: Date = new Date(),
): Promise<AppClaims> {
	// Only ES256, with our key. A token of the old form (HS256) is refused.
	if (decodeProtectedHeader(token).alg !== "ES256") {
		throw new Error("This kind of token is not accepted.");
	}
	const pub = await publicKey(env);
	if (!pub) throw new Error("No key to check this token.");
	const { payload } = await jwtVerify(token, await importJWK(pub, "ES256"), {
		issuer: ISSUER,
		audience: AUDIENCE,
		currentDate: now,
		algorithms: ["ES256"],
	});
	return toClaims(payload);
}

export const SIGN_OUT_TOKEN_SECONDS = 60;
const SIGN_OUT_AUDIENCE = "signout";

// A token that lets the accounts site end its own session for this reader with no question.
// It is not an access token: another audience, a purpose, and a life of one minute.
// Null while no private key is set, because the accounts site checks it with the public key.
export async function signSignOutToken(
	input: { userId: string; appId: string },
	env: TokenEnv,
	now: Date = new Date(),
): Promise<string | null> {
	const jwk = privateJwk(env);
	const pub = await publicKey(env);
	if (!jwk || !pub) return null;
	const issuedAt = Math.floor(now.getTime() / 1000);
	return new SignJWT({ app_id: input.appId, purpose: "signout" })
		.setProtectedHeader({ alg: "ES256", kid: pub.kid })
		.setSubject(input.userId)
		.setIssuer(ISSUER)
		.setAudience(SIGN_OUT_AUDIENCE)
		.setIssuedAt(issuedAt)
		.setExpirationTime(issuedAt + SIGN_OUT_TOKEN_SECONDS)
		.sign(await importJWK(jwk, "ES256"));
}

function toClaims(payload: JWTPayload): AppClaims {
	// A token made for one purpose is never an access token.
	if (payload.purpose !== undefined) throw new Error("This token is not an access token.");
	if (typeof payload.sub !== "string" || typeof payload.app_id !== "string") {
		throw new Error("The token has no reader or no app.");
	}
	const scopes = Array.isArray(payload.scopes)
		? payload.scopes.filter((scope): scope is string => typeof scope === "string")
		: [];
	return {
		sub: payload.sub,
		email: typeof payload.email === "string" ? payload.email : null,
		scopes,
		app_id: payload.app_id,
	};
}

// The token settings of this request: the Worker's bindings, or the process for local runs and tests.
export function tokenEnv(c: { env?: Record<string, unknown> }): TokenEnv {
	const read = (name: keyof TokenEnv) =>
		(c.env?.[name] as string | undefined) ?? process.env[name] ?? undefined;
	return {
		APP_JWT_PRIVATE_JWK: read("APP_JWT_PRIVATE_JWK"),
		ACCESS_TOKEN_SECONDS: read("ACCESS_TOKEN_SECONDS"),
	};
}
