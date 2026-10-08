import { describe, expect, it } from "bun:test";
import {
	type AccountStore,
	deleteAccount,
	listAccess,
	READER_TABLES,
	removeAccess,
} from "../../src/lib/consents.ts";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

type AppRow = {
	id: string;
	name: string;
	ownerId: string | null;
	status: string;
	logoUrl: string | null;
	primaryColor: string | null;
};
type Consent = { userId: string; appId: string; scopes: string[]; grantedAt: Date };

function memory() {
	const apps: AppRow[] = [
		{
			id: "urantiahub-app",
			name: "UrantiaHub",
			ownerId: "admin",
			status: "approved",
			logoUrl: null,
			primaryColor: null,
		},
		{
			id: "voices",
			name: "Our Paper Voices",
			ownerId: OTHER,
			status: "approved",
			logoUrl: null,
			primaryColor: "#b4532a",
		},
		{
			id: "log",
			name: "Reading Log",
			ownerId: OTHER,
			status: "approved",
			logoUrl: null,
			primaryColor: null,
		},
	];
	const consents: Consent[] = [
		{ userId: ME, appId: "urantiahub-app", scopes: ["profile"], grantedAt: new Date("2026-01-01") },
		{
			userId: ME,
			appId: "voices",
			scopes: ["profile", "bookmarks"],
			grantedAt: new Date("2026-03-23"),
		},
		{ userId: OTHER, appId: "voices", scopes: ["profile"], grantedAt: new Date("2026-03-01") },
	];
	// Rows of the reader tables, as "table:userId:appId".
	const rows = new Set<string>();
	for (const table of READER_TABLES) {
		rows.add(`${table}:${ME}:voices`);
		rows.add(`${table}:${OTHER}:voices`);
	}
	rows.add(`refresh_tokens:${ME}:log`);
	const users = new Set([ME, OTHER]);
	const calls: string[] = [];
	// Set to a step's name to make that step fail one time.
	const fail = { at: "" };
	const step = (name: string) => {
		calls.push(name);
		if (fail.at === name) {
			fail.at = "";
			throw new Error(`failed at ${name}`);
		}
	};
	const store: AccountStore = {
		async access(userId) {
			return consents
				.filter((c) => c.userId === userId)
				.map((c) => {
					const app = apps.find((a) => a.id === c.appId) as AppRow;
					return { ...app, appId: app.id, scopes: c.scopes, grantedAt: c.grantedAt };
				});
		},
		async removeAccess(userId, appId) {
			step(`access:${appId}`);
			for (let i = consents.length - 1; i >= 0; i--) {
				if (consents[i]?.userId === userId && consents[i]?.appId === appId) consents.splice(i, 1);
			}
			rows.delete(`refresh_tokens:${userId}:${appId}`);
			rows.delete(`auth_codes:${userId}:${appId}`);
		},
		async ownedApps(userId) {
			return apps
				.filter((a) => a.ownerId === userId)
				.map((a) => ({
					id: a.id,
					name: a.name,
					status: a.status,
					otherUsers: consents.filter((c) => c.appId === a.id && c.userId !== userId).length,
				}));
		},
		async deleteRows(table, userId) {
			step(table);
			for (const row of [...rows]) if (row.startsWith(`${table}:${userId}:`)) rows.delete(row);
			if (table === "user_consents") {
				for (let i = consents.length - 1; i >= 0; i--)
					if (consents[i]?.userId === userId) consents.splice(i, 1);
			}
		},
		async deleteApp(appId) {
			step(`app:${appId}`);
			const i = apps.findIndex((a) => a.id === appId);
			if (i >= 0) apps.splice(i, 1);
		},
		async deleteUser(userId) {
			step("user");
			if (apps.some((a) => a.ownerId === userId)) throw new Error("the user still owns an app");
			users.delete(userId);
		},
	};
	return { store, apps, consents, rows, users, calls, fail };
}

const ours = (app: { id: string }) => app.id === "urantiahub-app";

describe("the apps that a reader allowed", () => {
	it("lists them with their permissions and the day, and leaves out UrantiaHub itself", async () => {
		const { store } = memory();
		expect(await listAccess(store, ME, ours)).toEqual([
			{
				appId: "voices",
				name: "Our Paper Voices",
				logoUrl: null,
				primaryColor: "#b4532a",
				scopes: ["profile", "bookmarks"],
				grantedAt: "2026-03-23T00:00:00.000Z",
			},
		]);
	});

	it("is empty for a reader with no app", async () => {
		const { store } = memory();
		expect(await listAccess(store, "nobody", ours)).toEqual([]);
	});

	// The owner id and the review status are not for the reader's list.
	it("gives no field of the app's owner", async () => {
		const { store } = memory();
		const [row] = await listAccess(store, ME, ours);
		expect(Object.keys(row ?? {}).sort()).toEqual(
			["appId", "grantedAt", "logoUrl", "name", "primaryColor", "scopes"].sort(),
		);
	});
});

describe("remove the access of one app", () => {
	it("removes the consent and the tokens of that app for that reader only", async () => {
		const { store, consents, rows } = memory();
		await removeAccess(store, ME, "voices");
		expect(consents.map((c) => `${c.userId}:${c.appId}`)).toEqual([
			`${ME}:urantiahub-app`,
			`${OTHER}:voices`,
		]);
		expect(rows.has(`refresh_tokens:${ME}:voices`)).toBe(false);
		expect(rows.has(`auth_codes:${ME}:voices`)).toBe(false);
		// Another reader, and another app of this reader, are not touched.
		expect(rows.has(`refresh_tokens:${OTHER}:voices`)).toBe(true);
		expect(rows.has(`refresh_tokens:${ME}:log`)).toBe(true);
		// The reader's own bookmarks stay: they are the reader's, not the app's.
		expect(rows.has(`bookmarks:${ME}:voices`)).toBe(true);
	});

	it("is fine to run two times", async () => {
		const { store } = memory();
		await removeAccess(store, ME, "voices");
		await removeAccess(store, ME, "voices");
	});
});

describe("delete the account", () => {
	const input = (over: Partial<Parameters<typeof deleteAccount>[1]> = {}) => {
		const removed: string[] = [];
		return {
			removed,
			args: {
				userId: ME,
				email: "Reader@Example.com",
				typedEmail: "reader@example.com ",
				removeSignIn: async (id: string) => {
					removed.push(id);
				},
				...over,
			},
		};
	};

	it("refuses when the typed email is not the reader's, and deletes nothing", async () => {
		const { store, rows, calls } = memory();
		const before = rows.size;
		const { args, removed } = input({ typedEmail: "someone@else.example" });
		expect(await deleteAccount(store, args)).toEqual({ ok: false, reason: "email" });
		expect(rows.size).toBe(before);
		expect(calls).toEqual([]);
		expect(removed).toEqual([]);
	});

	it("refuses for a reader with no email on record: there is nothing to confirm against", async () => {
		const { store, calls } = memory();
		const { args } = input({ email: null, typedEmail: "" });
		expect(await deleteAccount(store, args)).toEqual({ ok: false, reason: "email" });
		expect(calls).toEqual([]);
	});

	it("removes each kind of the reader's data, then the reader, then the sign-in, in that order", async () => {
		const { store, rows, users, calls } = memory();
		const { args, removed } = input();
		expect(await deleteAccount(store, args)).toEqual({ ok: true });
		expect(calls).toEqual([...READER_TABLES, "user"]);
		expect([...rows].filter((r) => r.includes(`:${ME}:`))).toEqual([]);
		expect(users.has(ME)).toBe(false);
		expect(removed).toEqual([ME]);
	});

	it("touches nothing of another reader", async () => {
		const { store, rows, users, consents } = memory();
		await deleteAccount(store, input().args);
		for (const table of READER_TABLES) expect(rows.has(`${table}:${OTHER}:voices`)).toBe(true);
		expect(users.has(OTHER)).toBe(true);
		expect(consents).toHaveLength(1);
	});

	it("lists the reader tables that hold a user id", () => {
		expect([...READER_TABLES]).toEqual([
			"bookmarks",
			"notes",
			"reading_progress",
			"user_preferences",
			"app_user_data",
			"user_consents",
			"refresh_tokens",
			"auth_codes",
		]);
	});

	// A silent delete signs other people out of an app with no warning.
	it("refuses when the reader owns an approved app that other people use, and deletes nothing", async () => {
		const m = memory();
		m.apps.push({
			id: "mine",
			name: "My App",
			ownerId: ME,
			status: "approved",
			logoUrl: null,
			primaryColor: null,
		});
		m.consents.push({ userId: OTHER, appId: "mine", scopes: ["profile"], grantedAt: new Date() });
		const { args, removed } = input();
		expect(await deleteAccount(m.store, args)).toEqual({
			ok: false,
			reason: "apps",
			apps: ["My App"],
		});
		expect(m.calls).toEqual([]);
		expect(removed).toEqual([]);
	});

	it("deletes the reader's own apps that no other person uses, before the reader", async () => {
		const m = memory();
		m.apps.push({
			id: "mine",
			name: "My App",
			ownerId: ME,
			status: "approved",
			logoUrl: null,
			primaryColor: null,
		});
		m.apps.push({
			id: "draft",
			name: "Draft",
			ownerId: ME,
			status: "pending",
			logoUrl: null,
			primaryColor: null,
		});
		// The reader's own consent to the app does not count as another person.
		m.consents.push({ userId: ME, appId: "mine", scopes: ["profile"], grantedAt: new Date() });
		expect(await deleteAccount(m.store, input().args)).toEqual({ ok: true });
		expect(m.calls).toEqual([...READER_TABLES, "app:mine", "app:draft", "user"]);
		expect(m.apps.map((a) => a.id)).not.toContain("mine");
	});

	// An app that is not open to other people signs no one out, also with an old consent on record.
	it("deletes an app in review that has an old consent of another reader", async () => {
		const m = memory();
		m.apps.push({
			id: "draft",
			name: "Draft",
			ownerId: ME,
			status: "pending",
			logoUrl: null,
			primaryColor: null,
		});
		m.consents.push({ userId: OTHER, appId: "draft", scopes: ["profile"], grantedAt: new Date() });
		expect(await deleteAccount(m.store, input().args)).toEqual({ ok: true });
	});

	for (const at of [...READER_TABLES, "user"]) {
		it(`can run again and finish after a failure at "${at}"`, async () => {
			const m = memory();
			m.fail.at = at;
			const first = input();
			await expect(deleteAccount(m.store, first.args)).rejects.toThrow(`failed at ${at}`);
			// The sign-in is still there, so the reader can try again.
			expect(first.removed).toEqual([]);
			const second = input();
			expect(await deleteAccount(m.store, second.args)).toEqual({ ok: true });
			expect([...m.rows].filter((r) => r.includes(`:${ME}:`))).toEqual([]);
			expect(m.users.has(ME)).toBe(false);
			expect(second.removed).toEqual([ME]);
		});
	}

	it("can run again after the removal of the sign-in failed", async () => {
		const m = memory();
		const failing = input({
			removeSignIn: async () => {
				throw new Error("supabase is down");
			},
		});
		await expect(deleteAccount(m.store, failing.args)).rejects.toThrow("supabase is down");
		const again = input();
		expect(await deleteAccount(m.store, again.args)).toEqual({ ok: true });
		expect(again.removed).toEqual([ME]);
	});
});
