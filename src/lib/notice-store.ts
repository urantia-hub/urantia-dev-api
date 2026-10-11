import { and, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { noticeLog, pushSubscriptions, userPreferences, users } from "../db/schema.ts";
import { NOTICES_KEY, type NoticeStore, type ReaderRow } from "./notices.ts";

type Db = ReturnType<typeof getDb>["db"];

export function createNoticeStore(db: Db): NoticeStore & { prune(before: Date): Promise<void> } {
	return {
		async preferences(userId) {
			const [row] = await db
				.select({ preferences: userPreferences.preferences })
				.from(userPreferences)
				.where(eq(userPreferences.userId, userId))
				.limit(1);
			return (row?.preferences as Record<string, unknown>) ?? {};
		},
		// One statement, so a change of another key at the same moment is not lost.
		async savePreference(userId, key, value) {
			const patch = JSON.stringify({ [key]: value });
			await db
				.insert(userPreferences)
				.values({ userId, preferences: { [key]: value } })
				.onConflictDoUpdate({
					target: userPreferences.userId,
					set: {
						preferences: sql`${userPreferences.preferences} || ${patch}::jsonb`,
						updatedAt: new Date(),
					},
				});
		},
		async devices(userId) {
			return db
				.select({
					id: pushSubscriptions.id,
					endpoint: pushSubscriptions.endpoint,
					label: pushSubscriptions.label,
					kinds: pushSubscriptions.kinds,
				})
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.userId, userId))
				.orderBy(desc(pushSubscriptions.createdAt));
		},
		async saveDevice(userId, device, keep) {
			const { endpoint, p256dh, auth, kinds, label } = device;
			await db
				.insert(pushSubscriptions)
				.values({ userId, endpoint, p256dh, auth, kinds, label })
				.onConflictDoUpdate({
					target: pushSubscriptions.endpoint,
					set: { userId, p256dh, auth, kinds, label },
				});
			// The newest devices stay. The device of this request is one of them.
			const newest = db
				.select({ id: pushSubscriptions.id })
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.userId, userId))
				.orderBy(
					sql`(${pushSubscriptions.endpoint} = ${endpoint}) desc`,
					desc(pushSubscriptions.createdAt),
				)
				.limit(keep);
			await db
				.delete(pushSubscriptions)
				.where(and(eq(pushSubscriptions.userId, userId), notInArray(pushSubscriptions.id, newest)));
		},
		async removeDevice(userId, endpoint) {
			await db
				.delete(pushSubscriptions)
				.where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
		},
		async removeDevices(userId) {
			await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
		},
		async readers() {
			const devices = await db
				.select({
					userId: pushSubscriptions.userId,
					endpoint: pushSubscriptions.endpoint,
					p256dh: pushSubscriptions.p256dh,
					auth: pushSubscriptions.auth,
					kinds: pushSubscriptions.kinds,
				})
				.from(pushSubscriptions)
				.where(sql`cardinality(${pushSubscriptions.kinds}) > 0`);
			const withSettings = await db
				.select({ userId: userPreferences.userId })
				.from(userPreferences)
				.where(sql`jsonb_exists(${userPreferences.preferences}, ${NOTICES_KEY})`);
			const ids = [
				...new Set([...devices.map((d) => d.userId), ...withSettings.map((r) => r.userId)]),
			];
			if (ids.length === 0) return [];
			const rows = await db
				.select({ userId: users.id, email: users.email, preferences: userPreferences.preferences })
				.from(users)
				.leftJoin(userPreferences, eq(userPreferences.userId, users.id))
				.where(inArray(users.id, ids));
			return rows.map(
				(row): ReaderRow => ({
					userId: row.userId,
					email: row.email,
					preferences: (row.preferences as Record<string, unknown>) ?? {},
					devices: devices.filter((device) => device.userId === row.userId),
				}),
			);
		},
		async claim(claims) {
			const made = await db.insert(noticeLog).values(claims).onConflictDoNothing().returning({
				userId: noticeLog.userId,
				kind: noticeLog.kind,
				key: noticeLog.key,
				channel: noticeLog.channel,
			});
			return made as Awaited<ReturnType<NoticeStore["claim"]>>;
		},
		async release(claims) {
			for (const claim of claims) {
				await db
					.delete(noticeLog)
					.where(
						and(
							eq(noticeLog.userId, claim.userId),
							eq(noticeLog.kind, claim.kind),
							eq(noticeLog.key, claim.key),
							eq(noticeLog.channel, claim.channel),
						),
					);
			}
		},
		async removeEndpoints(endpoints) {
			if (endpoints.length > 0)
				await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints));
		},
		async touchEndpoints(endpoints, now) {
			if (endpoints.length > 0)
				await db
					.update(pushSubscriptions)
					.set({ lastOkAt: now })
					.where(inArray(pushSubscriptions.endpoint, endpoints));
		},
		async prune(before) {
			await db.delete(noticeLog).where(lt(noticeLog.sentAt, before));
		},
	};
}
