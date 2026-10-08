import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { refreshTokens, userConsents, users } from "../db/schema.ts";

// What the session rules need from the database. Tests use a version in memory.

export type RefreshRow = {
	id: string;
	userId: string;
	appId: string;
	// One sign-in on one device. Null for a token from before families existed.
	familyId: string | null;
	consumed: Date | null;
	expiresAt: Date;
};

export interface AuthStore {
	findRefreshToken(tokenHash: string, appId: string): Promise<RefreshRow | null>;
	insertRefreshToken(row: {
		userId: string;
		appId: string;
		tokenHash: string;
		familyId: string;
		expiresAt: Date;
	}): Promise<void>;
	// Marks a token as used. False if another request used it first.
	markConsumed(id: string, at: Date): Promise<boolean>;
	setFamily(id: string, familyId: string): Promise<void>;
	deleteFamily(familyId: string): Promise<void>;
	// The same, but only if the family belongs to this app. For a token whose own row is gone.
	deleteFamilyOfApp(familyId: string, appId: string): Promise<void>;
	// Each sign-in of this reader in this app. For a token from before families existed.
	deleteForUserAndApp(userId: string, appId: string): Promise<void>;
	deleteRefreshToken(id: string): Promise<void>;
	// Used tokens of one family that are older than the moment given.
	deleteConsumedBefore(familyId: string, before: Date): Promise<void>;
	// The scopes that the reader allows this app now, or null if the reader removed the app.
	consentedScopes(userId: string, appId: string): Promise<string[] | null>;
	userEmail(userId: string): Promise<string | null>;
}

type Db = ReturnType<typeof getDb>["db"];

export function createAuthStore(db: Db): AuthStore {
	return {
		async findRefreshToken(tokenHash, appId) {
			const [row] = await db
				.select()
				.from(refreshTokens)
				.where(and(eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.appId, appId)))
				.limit(1);
			if (!row) return null;
			return {
				id: row.id,
				userId: row.userId,
				appId: row.appId,
				familyId: row.familyId,
				consumed: row.consumed,
				expiresAt: row.expiresAt,
			};
		},
		async insertRefreshToken(row) {
			await db.insert(refreshTokens).values(row);
		},
		async markConsumed(id, at) {
			const done = await db
				.update(refreshTokens)
				.set({ consumed: at })
				.where(and(eq(refreshTokens.id, id), isNull(refreshTokens.consumed)))
				.returning({ id: refreshTokens.id });
			return done.length > 0;
		},
		async setFamily(id, familyId) {
			await db.update(refreshTokens).set({ familyId }).where(eq(refreshTokens.id, id));
		},
		async deleteFamily(familyId) {
			await db.delete(refreshTokens).where(eq(refreshTokens.familyId, familyId));
		},
		async deleteFamilyOfApp(familyId, appId) {
			await db
				.delete(refreshTokens)
				.where(and(eq(refreshTokens.familyId, familyId), eq(refreshTokens.appId, appId)));
		},
		async deleteForUserAndApp(userId, appId) {
			await db
				.delete(refreshTokens)
				.where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.appId, appId)));
		},
		async deleteRefreshToken(id) {
			await db.delete(refreshTokens).where(eq(refreshTokens.id, id));
		},
		async deleteConsumedBefore(familyId, before) {
			await db
				.delete(refreshTokens)
				.where(
					and(
						eq(refreshTokens.familyId, familyId),
						isNotNull(refreshTokens.consumed),
						lt(refreshTokens.consumed, before),
					),
				);
		},
		async consentedScopes(userId, appId) {
			const [row] = await db
				.select({ scopes: userConsents.scopes })
				.from(userConsents)
				.where(and(eq(userConsents.userId, userId), eq(userConsents.appId, appId)))
				.limit(1);
			return row ? row.scopes : null;
		},
		async userEmail(userId) {
			const [row] = await db
				.select({ email: users.email })
				.from(users)
				.where(eq(users.id, userId))
				.limit(1);
			return row?.email ?? null;
		},
	};
}
