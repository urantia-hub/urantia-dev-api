import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getDb } from "../db/client.ts";
import { apps } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { createNoticeStore } from "../lib/notice-store.ts";
import {
	dueReaders,
	MAX_DEVICES,
	mergeSettings,
	NOTICE_KINDS,
	NOTICES_KEY,
	type NoticeStore,
	parseClaims,
	parseDevice,
	parseSettings,
	pushEndpoint,
} from "../lib/notices.ts";
import { sha256 } from "../lib/sessions.ts";
import { isFirstPartyApp } from "../lib/token-access.ts";

// The notices of UrantiaHub. The reader's part is under /me. The other part is for the Hub's
// server only, with the secret of the app. None of these routes is in the public spec.

type Deps = {
	store(c: Context): NoticeStore & { prune?(before: Date): Promise<void> };
	app(
		c: Context,
		id: string,
	): Promise<{ id: string; ownerId: string | null; secretHash: string } | null>;
	setting(c: Context, name: "FIRST_PARTY_APP_IDS" | "ADMIN_USER_IDS"): string | undefined;
	now(): Date;
};

const live: Deps = {
	store: (c) => createNoticeStore(getDb(c.env?.HYPERDRIVE).db),
	app: async (c, id) => {
		const { db } = getDb(c.env?.HYPERDRIVE);
		const [row] = await db
			.select({ id: apps.id, ownerId: apps.ownerId, secretHash: apps.secretHash })
			.from(apps)
			.where(eq(apps.id, id))
			.limit(1);
		return row ?? null;
	},
	setting: (c, name) => (c.env?.[name] as string | undefined) ?? process.env[name],
	now: () => new Date(),
};

const LOG_DAYS = 90;
const MAX_ENDPOINTS = 500;

async function body(c: Context): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		return null;
	}
}

export function createNoticesRoute(deps: Deps = live) {
	const route = createApp();

	const reader = (c: Context): string | null =>
		(c.get("user") as { id: string } | null)?.id ?? null;
	const NO_READER = "Authentication required. Provide a valid Bearer token.";

	route.get("/me/notices", async (c) => {
		const userId = reader(c);
		if (!userId) return problemJson(c, 401, NO_READER);
		const store = deps.store(c);
		const [preferences, devices] = await Promise.all([
			store.preferences(userId),
			store.devices(userId),
		]);
		// The browser knows its own address, and finds its row by the hash. No address goes back.
		const listed = await Promise.all(
			devices.map(async (device) => ({
				id: device.id,
				label: device.label,
				kinds: device.kinds,
				endpointHash: await sha256(device.endpoint),
			})),
		);
		return c.json(
			{ data: { settings: parseSettings(preferences[NOTICES_KEY]), devices: listed } },
			200,
		);
	});

	route.put("/me/notices", async (c) => {
		const userId = reader(c);
		if (!userId) return problemJson(c, 401, NO_READER);
		const store = deps.store(c);
		const stored = parseSettings((await store.preferences(userId))[NOTICES_KEY]);
		const next = mergeSettings(stored, await body(c), deps.now().getTime());
		if (!next) return problemJson(c, 400, "The settings are not valid.");
		await store.savePreference(userId, NOTICES_KEY, next);
		return c.json({ data: { settings: next } }, 200);
	});

	route.put("/me/push-subscriptions", async (c) => {
		const userId = reader(c);
		if (!userId) return problemJson(c, 401, NO_READER);
		const device = parseDevice(await body(c));
		if (!device) return problemJson(c, 400, "The device is not valid.");
		await deps.store(c).saveDevice(userId, device, MAX_DEVICES);
		return c.json({ data: { saved: true } }, 200);
	});

	// One device by its address, or each device of the reader with `all`.
	route.delete("/me/push-subscriptions", async (c) => {
		const userId = reader(c);
		if (!userId) return problemJson(c, 401, NO_READER);
		const given = (await body(c)) as { endpoint?: unknown; all?: unknown } | null;
		const store = deps.store(c);
		if (given?.all === true) await store.removeDevices(userId);
		else if (typeof given?.endpoint === "string") await store.removeDevice(userId, given.endpoint);
		else return problemJson(c, 400, "Name the device, or all devices.");
		return c.body(null, 204);
	});

	// Only the server of one of our own apps, with the secret of that app. Each other caller gets 404.
	async function ours(c: Context): Promise<boolean> {
		const secret = c.req.header("x-app-secret");
		if (!secret) return false;
		const app = await deps.app(c, c.req.param("appId") ?? "");
		if (!app || (await sha256(secret)) !== app.secretHash) return false;
		return isFirstPartyApp(
			app,
			deps.setting(c, "FIRST_PARTY_APP_IDS"),
			deps.setting(c, "ADMIN_USER_IDS"),
		);
	}
	const notFound = (c: Context) => problemJson(c, 404, "Not found.");

	route.get("/apps/:appId/notices", async (c) => {
		if (!(await ours(c))) return notFound(c);
		const store = deps.store(c);
		await store.prune?.(new Date(deps.now().getTime() - LOG_DAYS * 86_400_000));
		return c.json({ data: dueReaders(await store.readers()) }, 200);
	});

	route.post("/apps/:appId/notices/claim", async (c) => {
		if (!(await ours(c))) return notFound(c);
		const claims = parseClaims(await body(c));
		if (!claims) return problemJson(c, 400, "The claims are not valid.");
		return c.json({ data: { claimed: await deps.store(c).claim(claims) } }, 200);
	});

	route.post("/apps/:appId/notices/release", async (c) => {
		if (!(await ours(c))) return notFound(c);
		const claims = parseClaims(await body(c));
		if (!claims) return problemJson(c, 400, "The claims are not valid.");
		await deps.store(c).release(claims);
		return c.body(null, 204);
	});

	// "Turn this email off" from a link in an email. The Hub checked the link.
	route.post("/apps/:appId/notices/off", async (c) => {
		if (!(await ours(c))) return notFound(c);
		const given = (await body(c)) as { userId?: unknown; kind?: unknown } | null;
		const kind = NOTICE_KINDS.find((known) => known === given?.kind);
		if (typeof given?.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(given.userId) || !kind)
			return problemJson(c, 400, "Name the reader and the notice.");
		const store = deps.store(c);
		const stored = parseSettings((await store.preferences(given.userId))[NOTICES_KEY]);
		// A reader with no settings gets no email. Nothing to turn off, and no row is made.
		if (stored) {
			const next = mergeSettings(stored, { email: { [kind]: false } }, deps.now().getTime());
			if (next) await store.savePreference(given.userId, NOTICES_KEY, next);
		}
		return c.body(null, 204);
	});

	// What the push services said: these devices are gone, and these took the message.
	route.post("/apps/:appId/notices/devices", async (c) => {
		if (!(await ours(c))) return notFound(c);
		const given = (await body(c)) as { gone?: unknown; ok?: unknown } | null;
		const list = (value: unknown): string[] | null => {
			if (value === undefined) return [];
			if (!Array.isArray(value) || value.length > MAX_ENDPOINTS) return null;
			return value.every((item) => pushEndpoint(item) !== null) ? (value as string[]) : null;
		};
		const gone = list(given?.gone);
		const ok = list(given?.ok);
		if (!gone || !ok) return problemJson(c, 400, "The lists are not valid.");
		const store = deps.store(c);
		await store.removeEndpoints(gone);
		await store.touchEndpoints(ok, deps.now());
		return c.body(null, 204);
	});

	return route;
}

export const noticesRoute = createNoticesRoute();
