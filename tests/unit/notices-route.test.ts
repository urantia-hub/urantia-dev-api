import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
	type Claim,
	type Device,
	NOTICES_KEY,
	type NoticeStore,
	type ReaderRow,
} from "../../src/lib/notices.ts";
import { sha256 } from "../../src/lib/sessions.ts";
import { createNoticesRoute } from "../../src/routes/notices.ts";

const ME = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const SECRET = "the-secret-of-the-hub-app";
const NOW = new Date("2026-10-11T12:00:00Z");
const device: Device = {
	endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
	p256dh: "BPubKey_0123456789-abcdefghijklmnopqrstuvwxyz",
	auth: "authSecret_012345",
	kinds: ["daily"],
	label: "Chrome on Android",
};

function memory() {
	const state = {
		preferences: new Map<string, Record<string, unknown>>(),
		devices: [] as Array<Device & { userId: string; id: string; ok?: Date }>,
		log: [] as Claim[],
		pruned: null as Date | null,
	};
	const same = (a: Claim, b: Claim) =>
		a.userId === b.userId && a.kind === b.kind && a.key === b.key && a.channel === b.channel;
	const store: NoticeStore & { prune(before: Date): Promise<void> } = {
		preferences: async (userId) => state.preferences.get(userId) ?? {},
		savePreference: async (userId, key, value) => {
			state.preferences.set(userId, { ...(state.preferences.get(userId) ?? {}), [key]: value });
		},
		devices: async (userId) => state.devices.filter((d) => d.userId === userId),
		saveDevice: async (userId, given, keep) => {
			state.devices = state.devices.filter((d) => d.endpoint !== given.endpoint);
			state.devices.unshift({ ...given, userId, id: `id-${state.devices.length}` });
			const mine = state.devices.filter((d) => d.userId === userId).slice(keep);
			state.devices = state.devices.filter((d) => !mine.includes(d));
		},
		removeDevice: async (userId, endpoint) => {
			state.devices = state.devices.filter(
				(d) => !(d.userId === userId && d.endpoint === endpoint),
			);
		},
		removeDevices: async (userId) => {
			state.devices = state.devices.filter((d) => d.userId !== userId);
		},
		readers: async () =>
			[...new Set([...state.preferences.keys(), ...state.devices.map((d) => d.userId)])].map(
				(userId): ReaderRow => ({
					userId,
					email: `${userId.slice(-2)}@example.com`,
					preferences: state.preferences.get(userId) ?? {},
					devices: state.devices.filter((d) => d.userId === userId),
				}),
			),
		claim: async (claims) => {
			const made = claims.filter((claim) => !state.log.some((had) => same(had, claim)));
			state.log.push(...made);
			return made;
		},
		release: async (claims) => {
			state.log = state.log.filter((had) => !claims.some((claim) => same(had, claim)));
		},
		removeEndpoints: async (endpoints) => {
			state.devices = state.devices.filter((d) => !endpoints.includes(d.endpoint));
		},
		touchEndpoints: async (endpoints, now) => {
			for (const d of state.devices) if (endpoints.includes(d.endpoint)) d.ok = now;
		},
		prune: async (before) => {
			state.pruned = before;
		},
	};
	return { state, store };
}

let world: ReturnType<typeof memory>;
let signedIn: string | null;

async function build() {
	const secretHash = await sha256(SECRET);
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("user" as never, (signedIn ? { id: signedIn } : null) as never);
		await next();
	});
	app.route(
		"/",
		createNoticesRoute({
			store: () => world.store,
			app: async (_c, id) => {
				if (id === "urantiahub-app") return { id, ownerId: ADMIN, secretHash };
				if (id === "other-app") return { id, ownerId: "someone", secretHash };
				return null;
			},
			setting: (_c, name) => (name === "FIRST_PARTY_APP_IDS" ? "urantiahub-app" : ADMIN),
			now: () => NOW,
		}),
	);
	const call = (
		method: string,
		path: string,
		json?: unknown,
		headers: Record<string, string> = {},
	) =>
		app.request(path, {
			method,
			headers: { "content-type": "application/json", ...headers },
			body: json === undefined ? undefined : JSON.stringify(json),
		});
	return call;
}

beforeEach(() => {
	world = memory();
	signedIn = ME;
});

describe("the reader's notice settings", () => {
	it("answer 401 with no reader, on each route", async () => {
		signedIn = null;
		const call = await build();
		for (const [method, path] of [
			["GET", "/me/notices"],
			["PUT", "/me/notices"],
			["PUT", "/me/push-subscriptions"],
			["DELETE", "/me/push-subscriptions"],
		] as const) {
			expect((await call(method, path, {})).status).toBe(401);
		}
	});

	it("are null before the reader chose, and keep each change", async () => {
		const call = await build();
		expect((await (await call("GET", "/me/notices")).json()) as unknown).toEqual({
			data: { settings: null, devices: [] },
		});
		const saved = await call("PUT", "/me/notices", {
			email: { daily: true },
			zone: "Asia/Kolkata",
		});
		expect(saved.status).toBe(200);
		const { data } = (await (await call("GET", "/me/notices")).json()) as {
			data: { settings: unknown };
		};
		expect(data.settings).toEqual({
			email: { daily: true, reminder: false, releases: false },
			hour: 7,
			zone: "Asia/Kolkata",
			asked: false,
			at: NOW.getTime(),
		});
	});

	it("refuse a change that is not valid, and save nothing", async () => {
		const call = await build();
		expect((await call("PUT", "/me/notices", { hour: 99 })).status).toBe(400);
		expect((await call("PUT", "/me/notices")).status).toBe(400);
		expect(world.state.preferences.size).toBe(0);
	});

	it("keep the other preferences of the reader", async () => {
		world.state.preferences.set(ME, { "hub.place": { paperId: "2" } });
		const call = await build();
		await call("PUT", "/me/notices", { asked: true });
		expect(world.state.preferences.get(ME)?.["hub.place"]).toEqual({ paperId: "2" });
	});
});

describe("the reader's devices", () => {
	it("are saved, listed with a hash in place of the address, and removed", async () => {
		const call = await build();
		expect((await call("PUT", "/me/push-subscriptions", device)).status).toBe(200);
		const text = await (await call("GET", "/me/notices")).text();
		expect(text).not.toContain(device.endpoint);
		expect(text).not.toContain(device.auth);
		const { data } = JSON.parse(text) as { data: { devices: Array<Record<string, unknown>> } };
		expect(data.devices).toEqual([
			{
				id: "id-0",
				label: "Chrome on Android",
				kinds: ["daily"],
				endpointHash: await sha256(device.endpoint),
			},
		]);
		expect(
			(await call("DELETE", "/me/push-subscriptions", { endpoint: device.endpoint })).status,
		).toBe(204);
		expect(world.state.devices).toHaveLength(0);
	});

	it("refuse an address that is not of a push service", async () => {
		const call = await build();
		expect(
			(
				await call("PUT", "/me/push-subscriptions", {
					...device,
					endpoint: "https://example.com/x",
				})
			).status,
		).toBe(400);
		expect(world.state.devices).toHaveLength(0);
	});

	it("remove only the devices of this reader with `all`, and need a device or `all`", async () => {
		const call = await build();
		await call("PUT", "/me/push-subscriptions", device);
		world.state.devices.push({
			...device,
			endpoint: "https://fcm.googleapis.com/fcm/send/other",
			userId: "other",
			id: "x",
		});
		expect((await call("DELETE", "/me/push-subscriptions", {})).status).toBe(400);
		expect((await call("DELETE", "/me/push-subscriptions", { all: true })).status).toBe(204);
		expect(world.state.devices.map((d) => d.userId)).toEqual(["other"]);
	});
});

describe("the routes for the Hub's server", () => {
	const hub = { "x-app-secret": SECRET };
	const claim = { userId: ME, kind: "daily", key: "2026-10-11", channel: "email" };
	const routes: Array<[string, string]> = [
		["GET", "/apps/urantiahub-app/notices"],
		["POST", "/apps/urantiahub-app/notices/claim"],
		["POST", "/apps/urantiahub-app/notices/release"],
		["POST", "/apps/urantiahub-app/notices/off"],
		["POST", "/apps/urantiahub-app/notices/devices"],
	];

	it.each(
		routes,
	)("%s %s answers 404 with no secret, a wrong secret, or a reader's sign-in", async (method, path) => {
		const call = await build();
		const json = method === "GET" ? undefined : { claims: [claim] };
		expect((await call(method, path, json)).status).toBe(404);
		expect((await call(method, path, json, { "x-app-secret": "wrong" })).status).toBe(404);
	});

	it("answer 404 for an app that is not ours, also with its right secret", async () => {
		const call = await build();
		expect((await call("GET", "/apps/other-app/notices", undefined, hub)).status).toBe(404);
		expect((await call("GET", "/apps/no-app/notices", undefined, hub)).status).toBe(404);
	});

	it("list only the readers who can get a notice, and remove old log rows", async () => {
		const call = await build();
		await call("PUT", "/me/notices", { email: { daily: true } });
		world.state.preferences.set("00000000-0000-4000-8000-0000000000b2", {
			[NOTICES_KEY]: { email: {} },
		});
		const { data } = (await (
			await call("GET", "/apps/urantiahub-app/notices", undefined, hub)
		).json()) as {
			data: Array<{ userId: string; email: string }>;
		};
		expect(data.map((r) => r.userId)).toEqual([ME]);
		expect(data[0]?.email).toBe("a1@example.com");
		expect(world.state.pruned?.toISOString()).toBe("2026-07-13T12:00:00.000Z");
	});

	it("give a claim one time only, and give it again after a release", async () => {
		const call = await build();
		const post = async (path: string) =>
			call("POST", `/apps/urantiahub-app/notices/${path}`, { claims: [claim] }, hub);
		expect((await (await post("claim")).json()) as unknown).toEqual({ data: { claimed: [claim] } });
		expect((await (await post("claim")).json()) as unknown).toEqual({ data: { claimed: [] } });
		expect((await post("release")).status).toBe(204);
		expect((await (await post("claim")).json()) as unknown).toEqual({ data: { claimed: [claim] } });
		expect(
			(await call("POST", "/apps/urantiahub-app/notices/claim", { claims: [] }, hub)).status,
		).toBe(400);
	});

	it("turn one email off for one reader, and make no settings for a reader who has none", async () => {
		const call = await build();
		await call("PUT", "/me/notices", { email: { daily: true, releases: true } });
		const off = (json: unknown) => call("POST", "/apps/urantiahub-app/notices/off", json, hub);
		expect((await off({ userId: ME, kind: "daily" })).status).toBe(204);
		const settings = world.state.preferences.get(ME)?.[NOTICES_KEY] as {
			email: Record<string, boolean>;
		};
		expect(settings.email).toEqual({ daily: false, reminder: false, releases: true });
		expect(
			(await off({ userId: "00000000-0000-4000-8000-0000000000b2", kind: "daily" })).status,
		).toBe(204);
		expect(world.state.preferences.size).toBe(1);
		expect((await off({ userId: ME, kind: "weekly" })).status).toBe(400);
		expect((await off({ userId: "me", kind: "daily" })).status).toBe(400);
	});

	it("remove the devices that are gone, and note the ones that took a message", async () => {
		const call = await build();
		await call("PUT", "/me/push-subscriptions", device);
		const other = "https://fcm.googleapis.com/fcm/send/other";
		await call("PUT", "/me/push-subscriptions", { ...device, endpoint: other });
		const said = (json: unknown) => call("POST", "/apps/urantiahub-app/notices/devices", json, hub);
		expect((await said({ gone: [other], ok: [device.endpoint] })).status).toBe(204);
		expect(world.state.devices.map((d) => d.endpoint)).toEqual([device.endpoint]);
		expect(world.state.devices[0]?.ok).toEqual(NOW);
		expect((await said({ gone: ["https://example.com/x"] })).status).toBe(400);
	});
});
