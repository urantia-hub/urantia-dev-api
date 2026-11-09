import { eq } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import {
	apps,
	appUserData,
	bookmarks,
	notes,
	noticeLog,
	pushSubscriptions,
	readingProgress,
	sectionDays,
	userConsents,
	userPreferences,
	users,
} from "../db/schema.ts";

// The reader's copy of their own data (GET /auth/account/export). It leaves out what only works as
// a secret: refresh tokens, sign-in codes, app secrets, and the keys of the devices for push.

type Db = ReturnType<typeof getDb>["db"];
type Row = Record<string, unknown>;

export const EXPORT_VERSION = 1;

// Each row as JSON: a time becomes ISO 8601.
function plain(row: Row): Row {
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [
			key,
			value instanceof Date ? value.toISOString() : value,
		]),
	);
}

export type ExportParts = {
	account: Row | null;
	bookmarks: Row[];
	notes: Row[];
	readingProgress: Row[];
	preferences: Row | null;
	appData: Row[];
	appsAllowed: Row[];
	ownApps: Row[];
	devices: Row[];
	sectionDays: Row[];
	noticesSent: Row[];
};

export function buildExport(parts: ExportParts, now: Date): Row {
	return {
		version: EXPORT_VERSION,
		exportedAt: now.toISOString(),
		account: parts.account ? plain(parts.account) : null,
		bookmarks: parts.bookmarks.map(plain),
		notes: parts.notes.map(plain),
		readingProgress: parts.readingProgress.map(plain),
		preferences: parts.preferences ? plain(parts.preferences) : null,
		appData: parts.appData.map(plain),
		appsAllowed: parts.appsAllowed.map(plain),
		ownApps: parts.ownApps.map(plain),
		devices: parts.devices.map(plain),
		sectionDays: parts.sectionDays.map(plain),
		noticesSent: parts.noticesSent.map(plain),
	};
}

export async function readExport(db: Db, userId: string, now: Date = new Date()): Promise<Row> {
	const [
		account,
		bookmarkRows,
		noteRows,
		progressRows,
		preferenceRows,
		appDataRows,
		consentRows,
		ownAppRows,
		deviceRows,
		dayRows,
		noticeRows,
	] = await Promise.all([
		db
			.select({
				id: users.id,
				email: users.email,
				name: users.name,
				avatarUrl: users.avatarUrl,
				createdAt: users.createdAt,
			})
			.from(users)
			.where(eq(users.id, userId)),
		db
			.select({
				id: bookmarks.id,
				appId: bookmarks.appId,
				paragraphId: bookmarks.paragraphId,
				category: bookmarks.category,
				createdAt: bookmarks.createdAt,
				updatedAt: bookmarks.updatedAt,
			})
			.from(bookmarks)
			.where(eq(bookmarks.userId, userId)),
		db
			.select({
				id: notes.id,
				appId: notes.appId,
				paragraphId: notes.paragraphId,
				text: notes.text,
				format: notes.format,
				createdAt: notes.createdAt,
				updatedAt: notes.updatedAt,
			})
			.from(notes)
			.where(eq(notes.userId, userId)),
		db
			.select({
				appId: readingProgress.appId,
				paragraphId: readingProgress.paragraphId,
				readAt: readingProgress.readAt,
			})
			.from(readingProgress)
			.where(eq(readingProgress.userId, userId)),
		db
			.select({ preferences: userPreferences.preferences, updatedAt: userPreferences.updatedAt })
			.from(userPreferences)
			.where(eq(userPreferences.userId, userId)),
		db
			.select({
				appId: appUserData.appId,
				key: appUserData.key,
				value: appUserData.value,
				updatedAt: appUserData.updatedAt,
			})
			.from(appUserData)
			.where(eq(appUserData.userId, userId)),
		db
			.select({
				appId: userConsents.appId,
				scopes: userConsents.scopes,
				grantedAt: userConsents.grantedAt,
			})
			.from(userConsents)
			.where(eq(userConsents.userId, userId)),
		db
			.select({ id: apps.id, name: apps.name, status: apps.status, createdAt: apps.createdAt })
			.from(apps)
			.where(eq(apps.ownerId, userId)),
		db
			.select({
				label: pushSubscriptions.label,
				kinds: pushSubscriptions.kinds,
				createdAt: pushSubscriptions.createdAt,
			})
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.userId, userId)),
		db
			.select({
				day: sectionDays.day,
				paperId: sectionDays.paperId,
				sectionId: sectionDays.sectionId,
				how: sectionDays.how,
				at: sectionDays.at,
			})
			.from(sectionDays)
			.where(eq(sectionDays.userId, userId)),
		db
			.select({
				kind: noticeLog.kind,
				key: noticeLog.key,
				channel: noticeLog.channel,
				sentAt: noticeLog.sentAt,
			})
			.from(noticeLog)
			.where(eq(noticeLog.userId, userId)),
	]);

	return buildExport(
		{
			account: account[0] ?? null,
			bookmarks: bookmarkRows,
			notes: noteRows,
			readingProgress: progressRows,
			preferences: preferenceRows[0] ?? null,
			appData: appDataRows,
			appsAllowed: consentRows,
			ownApps: ownAppRows,
			devices: deviceRows,
			sectionDays: dayRows,
			noticesSent: noticeRows,
		},
		now,
	);
}
