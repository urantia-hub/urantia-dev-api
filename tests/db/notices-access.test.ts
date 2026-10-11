import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { exportJWK, generateKeyPair } from "jose";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { app } from "../../src/index.ts";
import { signAccessToken } from "../../src/lib/app-tokens.ts";

// Who can reach the notice settings of a reader. Another app with the "preferences" scope must not:
// it could turn on emails, add a device of its own, or read the reader's time zone.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const ME = "00000000-0000-4000-8000-0000000000d1";
const DEV = "00000000-0000-4000-8000-0000000000d2";
const ADMIN = "00000000-0000-4000-8000-0000000000d3";
const NAMES = [
	"DATABASE_URL",
	"SUPABASE_URL",
	"APP_JWT_PRIVATE_JWK",
	"FIRST_PARTY_APP_IDS",
	"ADMIN_USER_IDS",
] as const;

suite("the notice settings, by the app of the token", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });
	const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
	let ours = "";
	let theirs = "";

	beforeAll(async () => {
		const { privateKey } = await generateKeyPair("ES256", { extractable: true });
		process.env.APP_JWT_PRIVATE_JWK = JSON.stringify(await exportJWK(privateKey));
		process.env.DATABASE_URL = url;
		// Nothing listens here, so the check against the Supabase keys fails at once.
		process.env.SUPABASE_URL = "http://127.0.0.1:9";
		process.env.FIRST_PARTY_APP_IDS = "hub";
		process.env.ADMIN_USER_IDS = ADMIN;
		const env = { APP_JWT_PRIVATE_JWK: process.env.APP_JWT_PRIVATE_JWK };
		const token = async (appId: string) =>
			(
				await signAccessToken(
					{ sub: ME, email: "d1@example.com", scopes: ["preferences"], app_id: appId },
					env,
				)
			).token;
		ours = await token("hub");
		theirs = await token("other");
	});
	afterAll(async () => {
		for (const name of NAMES) {
			if (saved[name] === undefined) delete process.env[name];
			else process.env[name] = saved[name];
		}
		await client.end();
	});

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values([
			{ id: ME, email: "d1@example.com" },
			{ id: DEV, email: "d2@example.com" },
			{ id: ADMIN, email: "d3@example.com" },
		]);
		const one = (id: string, ownerId: string) => ({
			id,
			name: id,
			secretHash: "x",
			redirectUris: ["https://a/cb"],
			scopes: ["preferences"],
			ownerId,
			status: "approved",
		});
		await db.insert(schema.apps).values([one("hub", ADMIN), one("other", DEV)]);
		await db.insert(schema.userConsents).values([
			{ userId: ME, appId: "hub", scopes: ["preferences"] },
			{ userId: ME, appId: "other", scopes: ["preferences"] },
		]);
	});

	const call = (token: string, method: string, path: string, json?: unknown) =>
		app.request(path, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				"cf-connecting-ip": "notices-access-test",
			},
			body: json === undefined ? undefined : JSON.stringify(json),
		});
	const device = {
		endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
		p256dh: "BPubKey_0123456789-abcdefghijklmnopqrstuvwxyz",
		auth: "authSecret_012345",
		kinds: ["daily"],
	};

	it("lets our own app read and change them", async () => {
		expect((await call(ours, "PUT", "/me/notices", { email: { daily: true } })).status).toBe(200);
		expect((await call(ours, "PUT", "/me/push-subscriptions", device)).status).toBe(200);
		expect((await call(ours, "GET", "/me/notices")).status).toBe(200);
	});

	it("refuses another app on each route, also with the scope and the reader's consent", async () => {
		expect((await call(theirs, "GET", "/me/notices")).status).toBe(403);
		expect((await call(theirs, "PUT", "/me/notices", { email: { daily: true } })).status).toBe(403);
		expect((await call(theirs, "PUT", "/me/push-subscriptions", device)).status).toBe(403);
		expect((await call(theirs, "DELETE", "/me/push-subscriptions", { all: true })).status).toBe(
			403,
		);
		const rows = await db.execute(sql`select 1 from push_subscriptions`);
		expect(rows).toHaveLength(0);
	});

	it("keeps the settings out of the shared preferences: another app cannot read or write them there", async () => {
		await call(ours, "PUT", "/me/notices", { email: { daily: true }, zone: "Europe/Berlin" });
		const put = await call(theirs, "PUT", "/me/preferences", {
			"other.theme": "dark",
			"hub.notices": { email: { daily: true, reminder: true, releases: true } },
		});
		expect(put.status).toBe(200);
		expect(await put.text()).not.toContain("hub.notices");
		const read = await (await call(theirs, "GET", "/me/preferences")).text();
		expect(read).toContain("other.theme");
		expect(read).not.toContain("hub.notices");
		expect(read).not.toContain("Europe/Berlin");
		const { data } = (await (await call(ours, "GET", "/me/notices")).json()) as {
			data: { settings: { email: Record<string, boolean>; zone: string } };
		};
		expect(data.settings.email).toEqual({ daily: true, reminder: false, releases: false });
		expect(data.settings.zone).toBe("Europe/Berlin");
	});
});
