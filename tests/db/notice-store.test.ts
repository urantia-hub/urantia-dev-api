import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { createAccountStore } from "../../src/lib/account-store.ts";
import { READER_TABLES } from "../../src/lib/consents.ts";
import { createNoticeStore } from "../../src/lib/notice-store.ts";
import { type Claim, type Device, dueReaders, NOTICES_KEY } from "../../src/lib/notices.ts";

// The real queries on a real Postgres of this machine. See tests/db/account-store.test.ts.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const device = (n: number, kinds: Device["kinds"] = ["daily"]): Device => ({
	endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
	p256dh: "BPubKey_0123456789-abcdefghijklmnopqrstuvwxyz",
	auth: "authSecret_012345",
	kinds,
	label: `Device ${n}`,
});
const claim = (over: Partial<Claim> = {}): Claim => ({
	userId: ME,
	kind: "daily",
	key: "2026-10-11",
	channel: "email",
	...over,
});

suite("the notice queries, on a real database", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });
	const store = createNoticeStore(db as never);

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values([
			{ id: ME, email: "me@example.com" },
			{ id: OTHER, email: "other@example.com" },
		]);
	});
	afterAll(async () => {
		await client.end();
	});

	it("saves one key of the preferences and keeps the others", async () => {
		await store.savePreference(ME, "hub.place", { paperId: "2" });
		await store.savePreference(ME, NOTICES_KEY, { email: { daily: true } });
		await store.savePreference(ME, NOTICES_KEY, { email: { daily: false } });
		expect(await store.preferences(ME)).toEqual({
			"hub.place": { paperId: "2" },
			[NOTICES_KEY]: { email: { daily: false } },
		});
		expect(await store.preferences(OTHER)).toEqual({});
	});

	it("keeps one row for a device, and gives it to the reader who saved it last", async () => {
		await store.saveDevice(ME, device(1), 10);
		await store.saveDevice(ME, device(1, ["daily", "releases"]), 10);
		expect((await store.devices(ME)).map((d) => d.kinds)).toEqual([["daily", "releases"]]);
		await store.saveDevice(OTHER, device(1, ["reminder"]), 10);
		expect(await store.devices(ME)).toEqual([]);
		expect((await store.devices(OTHER)).map((d) => d.kinds)).toEqual([["reminder"]]);
	});

	it("keeps the newest devices only, and always the one of the request", async () => {
		for (let n = 1; n <= 4; n++) await store.saveDevice(ME, device(n), 3);
		const kept = (await store.devices(ME)).map((d) => d.label).sort();
		expect(kept).toHaveLength(3);
		expect(kept).toContain("Device 4");
		// A device that the reader had before is saved again: it stays, and another one goes.
		await store.saveDevice(ME, device(1), 3);
		expect((await store.devices(ME)).map((d) => d.label)).toContain("Device 1");
		expect(await store.devices(ME)).toHaveLength(3);
		await store.saveDevice(OTHER, device(9), 3);
		expect(await store.devices(OTHER)).toHaveLength(1);
	});

	it("removes one device of the reader, or each of them, and no device of another reader", async () => {
		await store.saveDevice(ME, device(1), 10);
		await store.saveDevice(ME, device(2), 10);
		await store.saveDevice(OTHER, device(3), 10);
		await store.removeDevice(OTHER, device(1).endpoint);
		expect(await store.devices(ME)).toHaveLength(2);
		await store.removeDevice(ME, device(1).endpoint);
		expect(await store.devices(ME)).toHaveLength(1);
		await store.removeDevices(ME);
		expect(await store.devices(ME)).toHaveLength(0);
		expect(await store.devices(OTHER)).toHaveLength(1);
	});

	it("gives a claim one time, also when two runs ask at the same moment", async () => {
		const [first, second] = await Promise.all([store.claim([claim()]), store.claim([claim()])]);
		expect((first?.length ?? 0) + (second?.length ?? 0)).toBe(1);
		expect(await store.claim([claim(), claim({ channel: "push" })])).toEqual([
			claim({ channel: "push" }),
		]);
		await store.release([claim()]);
		expect(await store.claim([claim()])).toEqual([claim()]);
	});

	it("removes old log rows only", async () => {
		await store.claim([claim({ key: "old" }), claim({ key: "new" })]);
		await db.execute(
			sql`update notice_log set sent_at = now() - interval '100 days' where key = 'old'`,
		);
		await store.prune(new Date(Date.now() - 90 * 86_400_000));
		expect(await store.claim([claim({ key: "new" })])).toEqual([]);
		expect(await store.claim([claim({ key: "old" })])).toHaveLength(1);
	});

	it("lists the readers with settings or with a device, with the email and the devices of each", async () => {
		await store.savePreference(ME, NOTICES_KEY, { email: { daily: true }, hour: 7, zone: "UTC" });
		await store.saveDevice(OTHER, device(3), 10);
		await store.saveDevice(OTHER, device(4, []), 10);
		const rows = await store.readers();
		expect(rows.map((r) => r.userId).sort()).toEqual([ME, OTHER]);
		const due = dueReaders(rows);
		expect(due.find((r) => r.userId === ME)?.email).toBe("me@example.com");
		expect(due.find((r) => r.userId === OTHER)?.devices.map((d) => d.endpoint)).toEqual([
			device(3).endpoint,
		]);
	});

	it("removes the devices that are gone, and notes the ones that took a message", async () => {
		await store.saveDevice(ME, device(1), 10);
		await store.saveDevice(ME, device(2), 10);
		await store.removeEndpoints([device(1).endpoint]);
		await store.touchEndpoints([device(2).endpoint], new Date("2026-10-11T12:00:00Z"));
		const rows = await db.execute(sql`select endpoint, last_ok_at from push_subscriptions`);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.last_ok_at).not.toBeNull();
		await store.removeEndpoints([]);
	});

	it("leaves no device and no log row when the account is deleted", async () => {
		await store.saveDevice(ME, device(1), 10);
		await store.claim([claim()]);
		const account = createAccountStore(db as never);
		for (const table of READER_TABLES) await account.deleteRows(table, ME);
		expect(await store.devices(ME)).toEqual([]);
		expect(await store.claim([claim()])).toHaveLength(1);
	});
});
