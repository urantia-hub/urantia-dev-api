import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import {
	apps,
	appUserData,
	authCodes,
	bookmarks,
	notes,
	readingProgress,
	refreshTokens,
	userConsents,
	userPreferences,
	users,
} from "../db/schema.ts";
import type { AccountStore, ReaderTable } from "./consents.ts";

type Db = ReturnType<typeof getDb>["db"];

// Each reader table and its user column. A new reader table must be added here and in READER_TABLES.
const TABLES = {
	bookmarks: [bookmarks, bookmarks.userId],
	notes: [notes, notes.userId],
	reading_progress: [readingProgress, readingProgress.userId],
	user_preferences: [userPreferences, userPreferences.userId],
	app_user_data: [appUserData, appUserData.userId],
	user_consents: [userConsents, userConsents.userId],
	refresh_tokens: [refreshTokens, refreshTokens.userId],
	auth_codes: [authCodes, authCodes.userId],
} as const satisfies Record<ReaderTable, readonly [unknown, unknown]>;

export function createAccountStore(db: Db): AccountStore {
	return {
		async access(userId) {
			return db
				.select({
					appId: apps.id,
					name: apps.name,
					ownerId: apps.ownerId,
					logoUrl: apps.logoUrl,
					primaryColor: apps.primaryColor,
					scopes: userConsents.scopes,
					grantedAt: userConsents.grantedAt,
				})
				.from(userConsents)
				.innerJoin(apps, eq(apps.id, userConsents.appId))
				.where(eq(userConsents.userId, userId))
				.orderBy(userConsents.grantedAt);
		},
		async removeAccess(userId, appId) {
			// The consent goes first: from that moment each request of the app is refused.
			await db
				.delete(userConsents)
				.where(and(eq(userConsents.userId, userId), eq(userConsents.appId, appId)));
			await db
				.delete(refreshTokens)
				.where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.appId, appId)));
			await db
				.delete(authCodes)
				.where(and(eq(authCodes.userId, userId), eq(authCodes.appId, appId)));
		},
		async ownedApps(userId) {
			const owned = await db
				.select({ id: apps.id, name: apps.name, status: apps.status })
				.from(apps)
				.where(eq(apps.ownerId, userId));
			const counts = await otherUserCounts(
				db,
				owned.map((app) => app.id),
				userId,
			);
			return owned.map((app) => ({ ...app, otherUsers: counts.get(app.id) ?? 0 }));
		},
		async deleteRows(table, userId) {
			const [target, column] = TABLES[table];
			await db.delete(target).where(eq(column, userId));
		},
		async deleteApp(appId) {
			await db.delete(apps).where(eq(apps.id, appId));
		},
		async deleteUser(userId) {
			await db.delete(users).where(eq(users.id, userId));
		},
	};
}

// Used by the token check: the scopes that a reader allows an app now. Null when there is no consent.
export async function consentNow(db: Db, userId: string, appId: string): Promise<string[] | null> {
	const [row] = await db
		.select({ scopes: userConsents.scopes })
		.from(userConsents)
		.where(and(eq(userConsents.userId, userId), eq(userConsents.appId, appId)))
		.limit(1);
	return row ? row.scopes : null;
}

// For each app, the count of readers who allowed it, without this reader.
export async function otherUserCounts(
	db: Db,
	appIds: string[],
	userId: string,
): Promise<Map<string, number>> {
	if (appIds.length === 0) return new Map();
	const rows = await db
		.select({ appId: userConsents.appId, count: sql<number>`count(*)::int` })
		.from(userConsents)
		.where(and(inArray(userConsents.appId, appIds), ne(userConsents.userId, userId)))
		.groupBy(userConsents.appId);
	return new Map(rows.map((row) => [row.appId, Number(row.count)]));
}
