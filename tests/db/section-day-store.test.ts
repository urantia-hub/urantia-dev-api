import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { createNoticeStore } from "../../src/lib/notice-store.ts";
import { dueReaders, NOTICES_KEY, STREAK_KEY } from "../../src/lib/notices.ts";
import { createSectionDayStore } from "../../src/lib/section-day-store.ts";
import type { SectionRow } from "../../src/lib/section-days.ts";

// The real queries on a real Postgres of this machine. See tests/db/account-store.test.ts.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const day = (daysAgo: number) =>
	new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const row = (over: Partial<SectionRow> = {}): SectionRow => ({
	day: day(1),
	paperId: "3",
	sectionId: "4",
	how: "read",
	...over,
});

suite("the section_days queries, on a real database", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });
	const store = createSectionDayStore(db as never);

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values([
			{ id: ME, email: "me@example.com" },
			{ id: OTHER, email: "other@example.com" },
		]);
	});
	afterAll(() => client.end());

	it("count only new rows, and make a read row heard", async () => {
		expect(await store.add(ME, [row(), row({ sectionId: "5" })])).toBe(2);
		expect(await store.add(ME, [row({ how: "heard" }), row({ sectionId: "6" })])).toBe(1);
		expect(await store.add(ME, [row({ how: "read" })])).toBe(0);
		const mine = await store.list(ME, null);
		expect(mine.map((r) => `${r.sectionId}:${r.how}`).sort()).toEqual([
			"4:heard",
			"5:read",
			"6:read",
		]);
	});

	it("keep the rows of each reader apart, and list from a day on", async () => {
		await store.add(ME, [row({ day: day(10) }), row({ day: day(1) })]);
		await store.add(OTHER, [row()]);
		expect(await store.list(ME, null)).toHaveLength(2);
		expect((await store.list(ME, day(2))).map((r) => r.day)).toEqual([day(1)]);
	});

	it("give the job the recent counts of a reader who keeps a streak", async () => {
		await db.insert(schema.userPreferences).values({
			userId: ME,
			preferences: {
				[NOTICES_KEY]: {
					email: {},
					push: { streak: true },
					hour: 7,
					zone: "UTC",
					asked: true,
					at: 1,
				},
				[STREAK_KEY]: { on: true, hour: 23 },
			},
		});
		await db.insert(schema.pushSubscriptions).values({
			userId: ME,
			endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
			p256dh: "BPubKey_0123456789-abcdefghijklmnopqrstuvwxyz",
			auth: "authSecret_012345",
		});
		await store.add(ME, [
			row({ day: day(1), sectionId: "10" }),
			row({ day: day(1), sectionId: "5" }),
			row({ day: day(40), paperId: "100" }),
		]);
		const [reader] = dueReaders(await createNoticeStore(db as never).readers());
		expect(reader?.userId).toBe(ME);
		expect(reader?.streak).toEqual({ on: true, hour: 23 });
		expect(reader?.sectionDays).toEqual([{ day: day(1), count: 2 }]);
		// Section 10 is after section 5 in the book, though "10" is before "5" as text.
		expect(reader?.lastSection).toEqual({ day: day(1), paperId: "3", sectionId: "10" });
	});
});
