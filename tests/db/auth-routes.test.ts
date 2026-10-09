import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { app } from "../../src/index.ts";

// The routes themselves, with a real sign-in check and a Postgres of this machine: who can do what.
// The pure rules have unit tests. These tests fail when a route stops asking its rule.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const OWNER = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";
const ADMIN = "00000000-0000-4000-8000-0000000000c3";
const BASE = "https://api.urantia.dev/auth/apps";
const LIVE_FILE = "3f2c1e52-77ab-4d0e-9c21-5b6f0a4d91e7.png";
const WAITING_FILE = "8a1d0c3b-52fe-4b7a-9e10-2c4f6a8b0d1e.png";
const STRAY_FILE = "0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e.png";

suite("the auth routes, with a real sign-in", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });
	const saved = process.env.DATABASE_URL;
	let server: ReturnType<typeof Bun.serve>;
	let issuer = "";
	let sign: (userId: string) => Promise<string>;

	// Each file that the store holds. The routes decide who can load one.
	const files = new Set([
		`sc/logo-${LIVE_FILE}`,
		`sc/logo-${WAITING_FILE}`,
		`sc/logo-${STRAY_FILE}`,
	]);
	const bucket = {
		get: async (key: string) =>
			files.has(key)
				? {
						body: new Uint8Array([1, 2, 3]),
						httpMetadata: { contentType: "image/png" },
						httpEtag: '"e"',
					}
				: null,
		delete: async () => {},
		list: async () => ({ objects: [] }),
	};

	beforeAll(async () => {
		const { publicKey, privateKey } = await generateKeyPair("ES256");
		const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" };
		server = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [jwk] }) });
		issuer = `http://127.0.0.1:${server.port}`;
		sign = (userId) =>
			new SignJWT({ email: `${userId.slice(-2)}@example.com` })
				.setProtectedHeader({ alg: "ES256", kid: "test-key" })
				.setSubject(userId)
				.setIssuer(`${issuer}/auth/v1`)
				.setAudience("authenticated")
				.setIssuedAt()
				.setExpirationTime("5m")
				.sign(privateKey);
		process.env.DATABASE_URL = url;
	});
	afterAll(async () => {
		if (saved === undefined) delete process.env.DATABASE_URL;
		else process.env.DATABASE_URL = saved;
		server.stop(true);
		await client.end();
	});

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values([
			{ id: OWNER, email: "c1@example.com" },
			{ id: OTHER, email: "c2@example.com" },
			{ id: ADMIN, email: "c3@example.com" },
		]);
		await db.insert(schema.apps).values({
			id: "sc",
			name: "Study Circle",
			secretHash: "x",
			ownerId: OWNER,
			status: "approved",
			redirectUris: ["https://sc.example/cb"],
			scopes: ["profile"],
			logoUrl: `${BASE}/sc/logo/${LIVE_FILE}`,
			pendingChange: {
				id: "req-1",
				requestedAt: "2026-10-08T12:00:00.000Z",
				name: "Study Circle Online",
				logoUrl: `${BASE}/sc/logo/${WAITING_FILE}`,
			},
		});
	});

	const call = async (who: string | null, method: string, path: string, body?: unknown) =>
		app.request(
			path,
			{
				method,
				headers: {
					"cf-connecting-ip": "auth-routes-test",
					"content-type": "application/json",
					...(who ? { authorization: `Bearer ${await sign(who)}` } : {}),
				},
				body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
			},
			{ SUPABASE_URL: issuer, ADMIN_USER_IDS: ADMIN, APP_LOGOS: bucket },
		);
	const detail = async (res: Response) => ((await res.json()) as { detail: string }).detail;
	const row = async () => (await db.select().from(schema.apps).where(eq(schema.apps.id, "sc")))[0];

	describe("a reader who does not own the app", () => {
		it("cannot change it, delete it, or get a new secret", async () => {
			for (const [method, path] of [
				["PATCH", "/auth/apps/sc"],
				["DELETE", "/auth/apps/sc"],
				["POST", "/auth/apps/sc/rotate-secret"],
				["DELETE", "/auth/apps/sc/logo"],
				["DELETE", "/auth/apps/sc/change/req-1"],
			] as const) {
				const res = await call(OTHER, method, path, { name: "Taken" });
				expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 403`);
				expect(await detail(res)).toBe("You do not own this app.");
			}
			const app = await row();
			expect(app?.name).toBe("Study Circle");
			expect(app?.secretHash).toBe("x");
			expect((app?.pendingChange as { id: string }).id).toBe("req-1");
		});

		it("cannot review: not a request, not a status, not the list", async () => {
			const seen = {
				name: "Study Circle",
				redirectUris: ["https://sc.example/cb"],
				scopes: ["profile"],
				logoUrl: `${BASE}/sc/logo/${LIVE_FILE}`,
			};
			for (const who of [OTHER, OWNER]) {
				for (const [method, path, body] of [
					["POST", "/auth/apps/sc/change/req-1/decision", { decision: "approve" }],
					["PATCH", "/auth/apps/sc/status", { status: "approved", seen }],
					[
						"PATCH",
						"/auth/apps/sc/status",
						{ status: "suspended", note: "A reason of ten letters." },
					],
					["GET", "/auth/admin/apps", undefined],
				] as const) {
					const res = await call(who, method, path, body);
					expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 403`);
					expect(await detail(res)).toBe("Admin access required.");
				}
			}
			const app = await row();
			expect(app?.status).toBe("approved");
			expect(app?.name).toBe("Study Circle");
		});
	});

	describe("an admin", () => {
		// The reviewer approves what the screen showed. With no "seen" there is nothing to compare.
		it("cannot approve an app without what the screen showed, or with something else", async () => {
			await db
				.update(schema.apps)
				.set({ status: "pending", pendingChange: null })
				.where(eq(schema.apps.id, "sc"));
			expect(
				(await call(ADMIN, "PATCH", "/auth/apps/sc/status", { status: "approved" })).status,
			).toBe(400);
			const other = {
				name: "Another Name",
				redirectUris: ["https://sc.example/cb"],
				scopes: ["profile"],
				logoUrl: `${BASE}/sc/logo/${LIVE_FILE}`,
			};
			expect(
				(await call(ADMIN, "PATCH", "/auth/apps/sc/status", { status: "approved", seen: other }))
					.status,
			).toBe(409);
			expect((await row())?.status).toBe("pending");
			const seen = { ...other, name: "Study Circle" };
			expect(
				(await call(ADMIN, "PATCH", "/auth/apps/sc/status", { status: "approved", seen })).status,
			).toBe(200);
			expect((await row())?.status).toBe("approved");
		});
	});

	describe("a logo file", () => {
		const live = `/auth/apps/sc/logo/${LIVE_FILE}`;
		const waiting = `/auth/apps/sc/logo/${WAITING_FILE}`;

		it("is public when it is the live logo of an approved app", async () => {
			expect((await call(null, "GET", live)).status).toBe(200);
		});

		it("is for the owner and an admin only while it waits for a review", async () => {
			expect((await call(null, "GET", waiting)).status).toBe(404);
			expect((await call(OTHER, "GET", waiting)).status).toBe(404);
			expect((await call(OWNER, "GET", waiting)).status).toBe(200);
			expect((await call(ADMIN, "GET", waiting)).status).toBe(200);
		});

		it("is for the owner and an admin only while the app is not approved", async () => {
			for (const status of ["pending", "declined", "suspended"]) {
				await db.update(schema.apps).set({ status }).where(eq(schema.apps.id, "sc"));
				expect(`${status} ${(await call(null, "GET", live)).status}`).toBe(`${status} 404`);
				expect(`${status} ${(await call(OTHER, "GET", live)).status}`).toBe(`${status} 404`);
				expect(`${status} ${(await call(OWNER, "GET", live)).status}`).toBe(`${status} 200`);
			}
		});

		it("is for no one when the app does not point at it", async () => {
			const stray = `/auth/apps/sc/logo/${STRAY_FILE}`;
			expect((await call(null, "GET", stray)).status).toBe(404);
			expect((await call(OWNER, "GET", stray)).status).toBe(404);
			expect((await call(ADMIN, "GET", stray)).status).toBe(404);
		});
	});

	describe("a deleted account", () => {
		beforeEach(async () => {
			await db.insert(schema.deletedUsers).values({ id: OWNER });
		});

		it("is no sign-in for any request", async () => {
			for (const [method, path] of [
				["GET", "/auth/apps"],
				["GET", "/me"],
				["PATCH", "/auth/apps/sc"],
				["DELETE", "/auth/apps/sc"],
			] as const) {
				const res = await call(OWNER, method, path, { name: "Back Again" });
				expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 401`);
			}
			expect((await row())?.name).toBe("Study Circle");
		});

		it("can still finish its delete", async () => {
			const res = await call(OWNER, "DELETE", "/auth/account", { email: "wrong@example.com" });
			// 400: the route ran and refused the email. 401 would mean that the reader is locked out.
			expect(res.status).not.toBe(401);
		});
	});
});
