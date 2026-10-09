import { describe, expect, it } from "bun:test";
import {
	applyRequest,
	type ChangeRequest,
	canLoadLogo,
	isLogoFile,
	logoKeys,
	newLogo,
	noteProblem,
	parseRequest,
	requestFor,
	sameAsSeen,
} from "../../src/lib/change-request.ts";

const live = {
	name: "Study Circle",
	redirectUris: ["https://studycircle.example/cb", "https://old.studycircle.example/cb"],
	scopes: ["profile", "bookmarks"],
	logoUrl: null,
};
const make = { id: "req-1", now: new Date("2026-10-08T12:00:00Z") };
const request = (wanted: Parameters<typeof requestFor>[1], existing: ChangeRequest | null = null) =>
	requestFor(live, wanted, existing, make);

describe("what an edit of an approved app sends to review", () => {
	it("is nothing when nothing that a reviewer approved is new", () => {
		expect(request({})).toBeNull();
		expect(request({ name: "Study Circle" })).toBeNull();
		expect(request({ name: "  Study Circle " })).toBeNull();
		expect(request({ redirectUris: [...live.redirectUris], scopes: [...live.scopes] })).toBeNull();
	});

	// Less is always safe: a removed address or permission needs no review.
	it("is nothing for a removed address or a removed permission", () => {
		expect(request({ redirectUris: ["https://studycircle.example/cb"] })).toBeNull();
		expect(request({ scopes: ["profile"] })).toBeNull();
	});

	it("holds a new name", () => {
		expect(request({ name: "Study Circle Online" })).toEqual({
			id: "req-1",
			requestedAt: "2026-10-08T12:00:00.000Z",
			name: "Study Circle Online",
		});
	});

	it("holds the whole list when one address is new, and when one permission is new", () => {
		const wanted = ["https://studycircle.example/cb", "https://app.studycircle.example/cb"];
		expect(request({ redirectUris: wanted })?.redirectUris).toEqual(wanted);
		expect(request({ scopes: ["profile", "notes"] })?.scopes).toEqual(["profile", "notes"]);
	});

	it("holds only the fields that are new", () => {
		const made = request({
			name: "New",
			redirectUris: [...live.redirectUris],
			scopes: ["profile"],
		});
		expect(Object.keys(made ?? {}).sort()).toEqual(["id", "name", "requestedAt"]);
	});

	it("holds a new logo", () => {
		expect(request({ logoUrl: "https://api.example/logo/abc.png" })?.logoUrl).toBe(
			"https://api.example/logo/abc.png",
		);
	});
});

describe("a second request", () => {
	const first: ChangeRequest = {
		id: "req-0",
		requestedAt: "2026-10-07T00:00:00.000Z",
		name: "Old Idea",
	};

	it("replaces the first and gets a new id", () => {
		expect(request({ name: "New Idea" }, first)).toEqual({
			id: "req-1",
			requestedAt: "2026-10-08T12:00:00.000Z",
			name: "New Idea",
		});
	});

	// The reviewer may have the first one open. The same content keeps its id, so the review can end.
	it("keeps the id when its content is the same", () => {
		expect(request({ name: "Old Idea" }, first)).toBe(first);
	});

	it("is nothing when the developer goes back to the live values: the request is withdrawn", () => {
		expect(request({ name: "Study Circle" }, first)).toBeNull();
	});

	// A logo upload names the logo only. A name, an address, or a permission that waits must stay.
	it("keeps each field that waits when the edit does not name that field", () => {
		const waiting: ChangeRequest = {
			id: "req-0",
			requestedAt: "2026-10-07T00:00:00.000Z",
			name: "Old Idea",
			scopes: ["profile", "notes"],
		};
		const made = request({ logoUrl: "https://api.example/logo/a.png" }, waiting);
		expect(made?.name).toBe("Old Idea");
		expect(made?.scopes).toEqual(["profile", "notes"]);
		expect(made?.logoUrl).toBe("https://api.example/logo/a.png");
		// An edit of the name only keeps the permissions that wait.
		expect(request({ name: "New Idea" }, waiting)?.scopes).toEqual(["profile", "notes"]);
	});

	it("keeps a waiting logo when the other fields change, and drops it only with a new logo", () => {
		const withLogo: ChangeRequest = { ...first, logoUrl: "https://api.example/logo/a.png" };
		expect(request({ name: "New Idea" }, withLogo)?.logoUrl).toBe("https://api.example/logo/a.png");
		expect(request({ name: "Study Circle" }, withLogo)).toEqual({
			id: "req-1",
			requestedAt: "2026-10-08T12:00:00.000Z",
			logoUrl: "https://api.example/logo/a.png",
		});
		expect(request({ logoUrl: "https://api.example/logo/b.png" }, withLogo)?.logoUrl).toBe(
			"https://api.example/logo/b.png",
		);
	});
});

describe("an approval", () => {
	it("applies exactly the stored values, and keeps the rest", () => {
		expect(
			applyRequest(live, { id: "r", requestedAt: "x", name: "New", scopes: ["profile", "notes"] }),
		).toEqual({
			name: "New",
			redirectUris: live.redirectUris,
			scopes: ["profile", "notes"],
			logoUrl: null,
		});
		expect(
			applyRequest(live, { id: "r", requestedAt: "x", logoUrl: "https://a/l.png" }).logoUrl,
		).toBe("https://a/l.png");
	});
});

describe("a request as the database holds it", () => {
	it("is read back as it was written", () => {
		const stored = {
			id: "r1",
			requestedAt: "2026-10-08T12:00:00.000Z",
			name: "New",
			redirectUris: ["https://a/cb"],
		};
		expect(parseRequest(stored)).toEqual(stored);
	});

	it("is nothing for a value that is not a request", () => {
		for (const value of [
			null,
			undefined,
			"x",
			1,
			[],
			{},
			{ id: "r" },
			{ id: 1, requestedAt: "x" },
		]) {
			expect(parseRequest(value)).toBeNull();
		}
	});

	it("drops a field of the wrong kind, so no approval applies it", () => {
		expect(
			parseRequest({ id: "r", requestedAt: "x", name: 5, scopes: "profile", redirectUris: [1] }),
		).toEqual({
			id: "r",
			requestedAt: "x",
		});
	});
});

// A developer who is declined or suspended must be told why.
describe("the note of a reviewer", () => {
	it("is needed, in 10 characters or more, for a decline and for a suspension", () => {
		for (const decision of ["declined", "suspended", "decline"] as const) {
			expect(noteProblem(decision, undefined)).toContain("10");
			expect(noteProblem(decision, "  too short ")).toContain("10");
			expect(noteProblem(decision, "The name is the name of another site.")).toBeNull();
		}
	});
	it("is not needed for an approval or a return to review", () => {
		for (const decision of ["approved", "pending", "approve"] as const) {
			expect(noteProblem(decision, undefined)).toBeNull();
		}
	});
});

// Each upload gets a key of its own. So a logo that waits for a review never replaces the live one,
// and an approval is one database statement that points the app at the new file.
describe("the file of a logo", () => {
	const ID = "3f2c1e52-77ab-4d0e-9c21-5b6f0a4d91e7";

	it("has a key and an address of its own for each upload", () => {
		expect(newLogo("study-circle", "png", ID)).toEqual({
			key: `study-circle/logo-${ID}.png`,
			url: `https://api.urantia.dev/auth/apps/study-circle/logo/${ID}.png`,
		});
	});

	it("names the object behind a stored address, for a clean-up", () => {
		expect(
			logoKeys("study-circle", `https://api.urantia.dev/auth/apps/study-circle/logo/${ID}.webp`),
		).toEqual([`study-circle/logo-${ID}.webp`]);
		// A logo from before each upload had its own key.
		expect(logoKeys("study-circle", "https://api.urantia.dev/auth/apps/study-circle/logo")).toEqual(
			["study-circle/logo.png", "study-circle/logo.jpg", "study-circle/logo.webp"],
		);
		expect(logoKeys("study-circle", null)).toEqual([]);
	});

	// The address is stored text. It must never name an object of another app, or any other path.
	it("names nothing for an address of another app, or one that is not a logo address", () => {
		for (const url of [
			`https://api.urantia.dev/auth/apps/other-app/logo/${ID}.png`,
			`https://evil.example/auth/apps/study-circle/logo/${ID}.png`,
			"https://api.urantia.dev/auth/apps/study-circle/logo/../../other-app/logo.png",
			`https://api.urantia.dev/auth/apps/study-circle/logo/${ID}.svg`,
			"",
		]) {
			expect(logoKeys("study-circle", url)).toEqual([]);
		}
	});

	it("knows the name of a logo file, and nothing else", () => {
		expect(isLogoFile(`${ID}.png`)).toBe(true);
		expect(isLogoFile(`${ID}.jpg`)).toBe(true);
		for (const file of [
			`${ID}.svg`,
			`${ID}.png/x`,
			`../${ID}.png`,
			"logo.png",
			`${ID.toUpperCase()}.png`,
			"",
		]) {
			expect(isLogoFile(file)).toBe(false);
		}
	});
});

// The reviewer approves what the screen showed. An app in review is live for its owner at once, so the
// owner can change it while the reviewer reads.
describe("what the reviewer saw", () => {
	const app = {
		name: "Reading Log",
		redirectUris: ["https://a/cb"],
		scopes: ["profile"],
		logoUrl: null,
	};
	it("is the app as it is now", () => {
		expect(sameAsSeen(app, { ...app, redirectUris: ["https://a/cb"] })).toBe(true);
	});
	it("is not, when the name, an address, a permission, or the logo is another", () => {
		expect(sameAsSeen(app, { ...app, name: "Reading Log 2" })).toBe(false);
		expect(sameAsSeen(app, { ...app, redirectUris: ["https://a/cb", "https://b/cb"] })).toBe(false);
		expect(sameAsSeen(app, { ...app, scopes: ["profile", "notes"] })).toBe(false);
		expect(sameAsSeen(app, { ...app, logoUrl: "https://x/l.png" })).toBe(false);
	});
});

// An image that no reviewer saw must not be public on our address.
describe("who can load a logo file", () => {
	const live = "https://api.urantia.dev/auth/apps/sc/logo/3f2c1e52-77ab-4d0e-9c21-5b6f0a4d91e7.png";
	const waiting =
		"https://api.urantia.dev/auth/apps/sc/logo/aaaaaaaa-77ab-4d0e-9c21-5b6f0a4d91e7.png";
	const app = { status: "approved", logoUrl: live, waitingLogoUrl: waiting };

	it("is each person, for the live logo of an approved app", () => {
		expect(canLoadLogo(app, live, false)).toBe(true);
	});
	it("is the owner and an admin only, for a logo that waits", () => {
		expect(canLoadLogo(app, waiting, false)).toBe(false);
		expect(canLoadLogo(app, waiting, true)).toBe(true);
	});
	it.each([
		"pending",
		"declined",
		"suspended",
		"other",
	])("is the owner and an admin only, for an app that is %s", (status) => {
		expect(canLoadLogo({ ...app, status }, live, false)).toBe(false);
		expect(canLoadLogo({ ...app, status }, live, true)).toBe(true);
	});
	it("is no one, for a file that the app does not point at now", () => {
		const old =
			"https://api.urantia.dev/auth/apps/sc/logo/bbbbbbbb-77ab-4d0e-9c21-5b6f0a4d91e7.png";
		expect(canLoadLogo(app, old, false)).toBe(false);
		expect(canLoadLogo(app, old, true)).toBe(false);
		expect(
			canLoadLogo({ status: "approved", logoUrl: null, waitingLogoUrl: null }, live, true),
		).toBe(false);
	});
});
