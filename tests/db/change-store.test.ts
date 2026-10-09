import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import type { ChangeRequest } from "../../src/lib/change-request.ts";
import {
	decideChange,
	setReviewStatus,
	withdrawChange,
	writeEdit,
} from "../../src/lib/change-store.ts";

// The real statements of an edit and of a review, on a Postgres of this machine. See account-store.test.ts.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const suite = local ? describe : describe.skip;

const OWNER = "00000000-0000-4000-8000-0000000000b1";
const LIVE = {
	name: "Study Circle",
	redirectUris: ["https://sc.example/cb", "https://old.sc.example/cb"],
	scopes: ["profile", "bookmarks"],
};
const REQUEST: ChangeRequest = {
	id: "req-1",
	requestedAt: "2026-10-08T12:00:00.000Z",
	name: "Study Circle Online",
	redirectUris: ["https://sc.example/cb", "https://app.sc.example/cb"],
};

suite("an edit and a review, on a real database", () => {
	const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	const db = drizzle(client, { schema });
	const d = db as never;
	const row = async () => (await db.select().from(schema.apps).where(eq(schema.apps.id, "sc")))[0];
	const setStatus = (status: string) =>
		db.update(schema.apps).set({ status }).where(eq(schema.apps.id, "sc"));

	beforeEach(async () => {
		await db.execute(sql`truncate users, apps, deleted_users cascade`);
		await db.insert(schema.users).values({ id: OWNER, email: "ana@example.com" });
		await db.insert(schema.apps).values({
			id: "sc",
			secretHash: "x",
			ownerId: OWNER,
			status: "approved",
			reviewNote: "an old note",
			...LIVE,
		});
	});
	afterAll(async () => {
		await client.end();
	});

	// What the developer wants: a new name, one address removed, one address added.
	const wanted = { name: REQUEST.name, redirectUris: REQUEST.redirectUris, scopes: LIVE.scopes };

	describe("an edit of an approved app", () => {
		it("keeps the app as it is, holds the request, and applies a removal at once", async () => {
			const written = await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: false });
			expect(written).toEqual({ status: "approved", pendingChange: REQUEST });
			const app = await row();
			expect(app?.name).toBe("Study Circle");
			// The removed address is gone now. The new address is not there yet.
			expect(app?.redirectUris).toEqual(["https://sc.example/cb"]);
			expect(app?.scopes).toEqual(LIVE.scopes);
			expect(app?.status).toBe("approved");
			expect(app?.pendingChange).toEqual(REQUEST);
			// The old note was about another version.
			expect(app?.reviewNote).toBeNull();
		});

		it("drops the request when the edit has nothing for a reviewer", async () => {
			await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: false });
			const back = {
				name: LIVE.name,
				redirectUris: ["https://sc.example/cb"],
				scopes: LIVE.scopes,
			};
			expect(
				(await writeEdit(d, "sc", { wanted: back, request: null, byAdmin: false }))?.pendingChange,
			).toBeNull();
			expect((await row())?.pendingChange).toBeNull();
		});

		it("leaves the request alone for an edit of the colors only", async () => {
			await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: false });
			await writeEdit(d, "sc", {
				wanted: { accentColor: "#112233", primaryColor: null },
				request: undefined,
				byAdmin: false,
			});
			const app = await row();
			expect(app?.accentColor).toBe("#112233");
			expect(app?.pendingChange).toEqual(REQUEST);
			expect(app?.name).toBe("Study Circle");
			expect(app?.redirectUris).toEqual(["https://sc.example/cb"]);
		});

		it("removes a permission at once, in the order that the app had", async () => {
			await writeEdit(d, "sc", {
				wanted: { scopes: ["bookmarks"] },
				request: null,
				byAdmin: false,
			});
			expect((await row())?.scopes).toEqual(["bookmarks"]);
		});

		it("applies an edit of an admin at once, with no request", async () => {
			await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: true });
			const app = await row();
			expect(app?.name).toBe("Study Circle Online");
			expect(app?.redirectUris).toEqual(REQUEST.redirectUris);
			expect(app?.pendingChange).toBeNull();
			expect(app?.status).toBe("approved");
		});
	});

	describe("an edit of an app that is not approved", () => {
		it("is live at once for an app in review, with no request", async () => {
			await setStatus("pending");
			const written = await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: false });
			expect(written).toEqual({ status: "pending", pendingChange: null });
			expect((await row())?.name).toBe("Study Circle Online");
			expect((await row())?.redirectUris).toEqual(REQUEST.redirectUris);
		});

		it("sends a declined app to review again when something for a reviewer is new", async () => {
			await setStatus("declined");
			expect((await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: false }))?.status).toBe(
				"pending",
			);
			expect((await row())?.reviewNote).toBeNull();
		});

		it("keeps a declined app declined for an edit of the colors only", async () => {
			await setStatus("declined");
			await writeEdit(d, "sc", {
				wanted: { accentColor: "#112233" },
				request: undefined,
				byAdmin: false,
			});
			expect((await row())?.status).toBe("declined");
			expect((await row())?.reviewNote).toBe("an old note");
		});

		// An edit must never lift a suspension, also one that an admin made a moment ago.
		it("never lifts a suspension", async () => {
			await setStatus("suspended");
			expect((await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: false }))?.status).toBe(
				"suspended",
			);
			expect((await row())?.status).toBe("suspended");
		});

		// The route read "pending" and the app was approved before the write: nothing unreviewed goes live.
		it("holds the request when the app was approved a moment before the write", async () => {
			const app = await row();
			expect(app?.status).toBe("approved");
			await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: false });
			expect((await row())?.name).toBe("Study Circle");
		});
	});

	describe("a new logo", () => {
		const LOGO =
			"https://api.urantia.dev/auth/apps/sc/logo/3f2c1e52-77ab-4d0e-9c21-5b6f0a4d91e7.png";
		const request: ChangeRequest = {
			id: "req-logo",
			requestedAt: "2026-10-08T12:00:00.000Z",
			logoUrl: LOGO,
		};

		// An approved app must never show an image that no reviewer saw.
		it("waits for a reviewer on an approved app", async () => {
			await writeEdit(d, "sc", { wanted: { logoUrl: LOGO }, request, byAdmin: false });
			const app = await row();
			expect(app?.logoUrl).toBeNull();
			expect(app?.pendingChange).toEqual(request);
			expect(app?.status).toBe("approved");
		});

		it("is live at once on an app in review", async () => {
			await setStatus("pending");
			await writeEdit(d, "sc", { wanted: { logoUrl: LOGO }, request, byAdmin: false });
			expect((await row())?.logoUrl).toBe(LOGO);
			expect((await row())?.pendingChange).toBeNull();
		});

		it("is applied by an approval", async () => {
			await writeEdit(d, "sc", { wanted: { logoUrl: LOGO }, request, byAdmin: false });
			await decideChange(d, "sc", "req-logo", {
				decision: "approve",
				values: { ...LIVE, logoUrl: LOGO },
			});
			expect((await row())?.logoUrl).toBe(LOGO);
		});
	});

	// An app in review is live for its owner at once, so its owner can change it while the reviewer reads.
	describe("the status that a reviewer sets", () => {
		const seen = { ...LIVE, logoUrl: null };
		beforeEach(async () => {
			await setStatus("pending");
		});

		it("approves the app that the reviewer saw", async () => {
			expect(await setReviewStatus(d, "sc", { status: "approved", note: null, seen })).toBe(true);
			const app = await row();
			expect(app?.status).toBe("approved");
			expect(app?.reviewNote).toBeNull();
			expect(app?.reviewedAt).toBeInstanceOf(Date);
		});

		it.each([
			["the name", { name: "Another Name" }],
			["an address", { redirectUris: [...LIVE.redirectUris, "https://evil.example/cb"] }],
			["the order of the addresses", { redirectUris: [...LIVE.redirectUris].reverse() }],
			["a permission", { scopes: [...LIVE.scopes, "notes"] }],
			["the logo", { logoUrl: "https://api.urantia.dev/auth/apps/sc/logo/x.png" }],
		])("does not approve when the developer changed %s after the reviewer looked", async (_what, change) => {
			await db.update(schema.apps).set(change).where(eq(schema.apps.id, "sc"));
			expect(await setReviewStatus(d, "sc", { status: "approved", note: null, seen })).toBe(false);
			expect((await row())?.status).toBe("pending");
		});

		it("declines and suspends with the note, with no need for what was seen", async () => {
			expect(
				await setReviewStatus(d, "sc", { status: "declined", note: "Say what the app does." }),
			).toBe(true);
			expect((await row())?.reviewNote).toBe("Say what the app does.");
			expect(
				await setReviewStatus(d, "sc", { status: "suspended", note: "It sent spam to its users." }),
			).toBe(true);
			expect((await row())?.status).toBe("suspended");
		});

		it("is false for an app that is not there", async () => {
			expect(
				await setReviewStatus(d, "nope", {
					status: "declined",
					note: "A note that is long enough.",
				}),
			).toBe(false);
		});
	});

	it("is nothing for an app that is not there", async () => {
		expect(await writeEdit(d, "nope", { wanted, request: REQUEST, byAdmin: false })).toBeNull();
	});

	describe("the decision of a reviewer", () => {
		const applied = {
			name: REQUEST.name as string,
			redirectUris: REQUEST.redirectUris as string[],
			scopes: LIVE.scopes,
			logoUrl: null,
		};
		beforeEach(async () => {
			await writeEdit(d, "sc", { wanted, request: REQUEST, byAdmin: false });
		});

		it("an approval applies the values and ends the request", async () => {
			expect(await decideChange(d, "sc", "req-1", { decision: "approve", values: applied })).toBe(
				true,
			);
			const app = await row();
			expect(app?.name).toBe("Study Circle Online");
			expect(app?.redirectUris).toEqual(REQUEST.redirectUris);
			expect(app?.pendingChange).toBeNull();
			expect(app?.status).toBe("approved");
			expect(app?.reviewedAt).toBeInstanceOf(Date);
		});

		it("a decline ends the request, keeps the app as it is, and keeps the note", async () => {
			expect(
				await decideChange(d, "sc", "req-1", {
					decision: "decline",
					note: "The name is the name of another site.",
				}),
			).toBe(true);
			const app = await row();
			expect(app?.name).toBe("Study Circle");
			expect(app?.pendingChange).toBeNull();
			expect(app?.status).toBe("approved");
			expect(app?.reviewNote).toBe("The name is the name of another site.");
		});

		// The developer sent a second request while the reviewer looked at the first.
		it("does nothing when the request changed, for an approval and for a decline", async () => {
			await writeEdit(d, "sc", {
				wanted,
				request: { ...REQUEST, id: "req-2", name: "Another Name" },
				byAdmin: false,
			});
			expect(await decideChange(d, "sc", "req-1", { decision: "approve", values: applied })).toBe(
				false,
			);
			expect(
				await decideChange(d, "sc", "req-1", {
					decision: "decline",
					note: "A note that is long enough.",
				}),
			).toBe(false);
			const app = await row();
			expect(app?.name).toBe("Study Circle");
			expect((app?.pendingChange as ChangeRequest).id).toBe("req-2");
		});

		it("does not approve a change of an app that is suspended", async () => {
			await setStatus("suspended");
			expect(await decideChange(d, "sc", "req-1", { decision: "approve", values: applied })).toBe(
				false,
			);
			expect((await row())?.name).toBe("Study Circle");
			// A suspension keeps the request.
			expect((await row())?.pendingChange).toEqual(REQUEST);
		});

		it("the developer can withdraw the request, and only that one", async () => {
			expect(await withdrawChange(d, "sc", "req-0")).toBe(false);
			expect(await withdrawChange(d, "sc", "req-1")).toBe(true);
			expect((await row())?.pendingChange).toBeNull();
			expect((await row())?.name).toBe("Study Circle");
			expect(await withdrawChange(d, "sc", "req-1")).toBe(false);
		});
	});
});
