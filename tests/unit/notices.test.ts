import { describe, expect, it } from "bun:test";
import {
	DEFAULT_HOUR,
	dueReaders,
	MAX_DEVICES,
	mergeSettings,
	parseClaims,
	parseDevice,
	parseSettings,
	validZone,
} from "../../src/lib/notices.ts";

const NOW = 1_791_000_000_000;
const OFF = { daily: false, reminder: false, releases: false };
const ME = "00000000-0000-4000-8000-0000000000a1";
const device = {
	endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
	p256dh: "BPubKey_0123456789-abcdefghijklmnopqrstuvwxyz",
	auth: "authSecret_012345",
	kinds: ["daily"],
	label: "Chrome on Android",
};

describe("a time zone", () => {
	it("is a name that the runtime knows", () => {
		expect(validZone("America/Chicago")).toBe(true);
		expect(validZone("Asia/Kolkata")).toBe(true);
		expect(validZone("Mars/Olympus")).toBe(false);
		expect(validZone("")).toBe(false);
		expect(validZone(5)).toBe(false);
	});
});

describe("the stored settings", () => {
	it("are null for what is not there or not of the right form", () => {
		expect(parseSettings(undefined)).toBeNull();
		expect(parseSettings("x")).toBeNull();
		expect(parseSettings({ email: "yes" })).toBeNull();
	});

	it("keep only the known fields", () => {
		const stored = {
			email: { daily: true, other: true },
			hour: 6,
			zone: "Europe/Berlin",
			asked: true,
			at: 5,
			x: 1,
		};
		expect(parseSettings(stored)).toEqual({
			email: { ...OFF, daily: true },
			hour: 6,
			zone: "Europe/Berlin",
			asked: true,
			at: 5,
		});
	});
});

describe("a change of the settings", () => {
	it("starts from all off, hour 7, and UTC", () => {
		expect(mergeSettings(null, { asked: true }, NOW)).toEqual({
			email: OFF,
			hour: DEFAULT_HOUR,
			zone: "UTC",
			asked: true,
			at: NOW,
		});
	});

	it("changes only the fields that it names", () => {
		const was = mergeSettings(null, { email: { daily: true }, hour: 21, zone: "Asia/Kolkata" }, 1);
		expect(mergeSettings(was, { email: { releases: true } }, NOW)).toEqual({
			email: { daily: true, reminder: false, releases: true },
			hour: 21,
			zone: "Asia/Kolkata",
			asked: false,
			at: NOW,
		});
	});

	it("is refused when a field is not valid, and never turns `asked` back off", () => {
		expect(mergeSettings(null, { hour: 24 }, NOW)).toBeNull();
		expect(mergeSettings(null, { hour: 7.5 }, NOW)).toBeNull();
		expect(mergeSettings(null, { zone: "Nowhere/Land" }, NOW)).toBeNull();
		expect(mergeSettings(null, { email: { daily: "yes" } }, NOW)).toBeNull();
		expect(mergeSettings(null, { email: { weekly: true } }, NOW)).toBeNull();
		expect(mergeSettings(null, "x", NOW)).toBeNull();
		const asked = mergeSettings(null, { asked: true }, 1);
		expect(mergeSettings(asked, { asked: false }, NOW)?.asked).toBe(true);
	});
});

describe("a device", () => {
	it("is accepted with an address of a push service, its two keys, and known kinds", () => {
		expect(parseDevice(device) as unknown).toEqual(device);
		expect(parseDevice({ ...device, endpoint: "https://web.push.apple.com/QGk" })?.kinds).toEqual([
			"daily",
		]);
		const bare = { ...device, kinds: [], label: undefined };
		expect(parseDevice(bare) as unknown).toEqual({ ...device, kinds: [], label: "" });
	});

	it("is refused for another host, so our server never calls an address that a browser chose", () => {
		for (const endpoint of [
			"https://example.com/push",
			"http://fcm.googleapis.com/fcm/send/abc",
			"https://fcm.googleapis.com.evil.example/x",
			"https://127.0.0.1/x",
			"not a url",
		]) {
			expect(parseDevice({ ...device, endpoint })).toBeNull();
		}
	});

	// Another program can read an odd address in another way than this one does.
	it("is refused for an address that two parsers can read in two ways", () => {
		for (const endpoint of [
			"https://fcm.googleapis.com\\@evil.example/x",
			"https://evil.example\\.fcm.googleapis.com/x",
			"https://fcm.googleapis.com\t/x",
			" https://fcm.googleapis.com/x",
			"https://fcm.googleapis.com/x\n",
			"https://fcm.googleapis.com./x",
			"https://user@fcm.googleapis.com/x",
			"https://fcm.googleapis.com:443@evil.example/x",
			"https://fcm.googleapis.com/x#@evil.example",
		]) {
			expect(parseDevice({ ...device, endpoint })).toBeNull();
		}
	});

	it("is stored in the one form that the parser gives", () => {
		const odd = "HTTPS://FCM.googleapis.com/fcm/send/AbC";
		expect(parseDevice({ ...device, endpoint: odd })?.endpoint).toBe(
			"https://fcm.googleapis.com/fcm/send/AbC",
		);
	});

	it("is refused for a kind that does not exist, a missing key, or text that is too long", () => {
		expect(parseDevice({ ...device, kinds: ["weekly"] })).toBeNull();
		expect(parseDevice({ ...device, auth: "" })).toBeNull();
		expect(parseDevice({ ...device, p256dh: "has spaces" })).toBeNull();
		expect(parseDevice({ ...device, label: "x".repeat(61) })).toBeNull();
		expect(
			parseDevice({ ...device, endpoint: `https://fcm.googleapis.com/${"x".repeat(2000)}` }),
		).toBeNull();
		expect(MAX_DEVICES).toBe(10);
	});
});

describe("a list of claims", () => {
	const claim = { userId: ME, kind: "daily", key: "2026-10-11", channel: "email" };
	it("is accepted when each one names a reader, a notice, a key, and a channel", () => {
		expect(parseClaims({ claims: [claim, { ...claim, channel: "push" }] })).toHaveLength(2);
	});
	it("is refused as a whole when one is not valid, or when it is empty or too long", () => {
		expect(parseClaims({ claims: [claim, { ...claim, userId: "me" }] })).toBeNull();
		expect(parseClaims({ claims: [{ ...claim, channel: "sms" }] })).toBeNull();
		expect(parseClaims({ claims: [{ ...claim, kind: "weekly" }] })).toBeNull();
		expect(parseClaims({ claims: [{ ...claim, key: "" }] })).toBeNull();
		expect(parseClaims({ claims: [] })).toBeNull();
		expect(parseClaims({ claims: Array.from({ length: 501 }, () => claim) })).toBeNull();
		expect(parseClaims(null)).toBeNull();
	});
});

describe("the readers that the Hub gets", () => {
	const row = (over: object) => ({
		userId: ME,
		email: "reader@example.com",
		preferences: {},
		devices: [],
		...over,
	});
	it("are only those with an email notice on, or a device with a notice", () => {
		const on = {
			"hub.notices": { email: { daily: true }, hour: 7, zone: "UTC", asked: true, at: 1 },
		};
		const off = { "hub.notices": { email: {}, hour: 7, zone: "UTC", asked: true, at: 1 } };
		const out = dueReaders([
			row({ preferences: on }),
			row({ userId: "b", preferences: off }),
			row({ userId: "c", preferences: off, devices: [{ ...device, kinds: [] }] }),
			row({ userId: "d", preferences: {}, devices: [device] }),
			row({ userId: "e", email: null, preferences: on }),
		]);
		expect(out.map((r) => r.userId)).toEqual([ME, "d"]);
	});

	it("carry the settings, the place, and only the devices that get a notice", () => {
		const preferences = {
			"hub.notices": {
				email: { reminder: true },
				hour: 9,
				zone: "Europe/Paris",
				asked: true,
				at: 1,
			},
			"hub.place": { paperId: "2", sectionId: "1", at: 777 },
			"other.app": { secret: 1 },
		};
		const [reader] = dueReaders([
			row({
				preferences,
				devices: [
					device,
					{ ...device, endpoint: "https://fcm.googleapis.com/fcm/send/zzz", kinds: [] },
				],
			}),
		]);
		expect(reader).toEqual({
			userId: ME,
			email: "reader@example.com",
			settings: {
				email: { ...OFF, reminder: true },
				hour: 9,
				zone: "Europe/Paris",
				asked: true,
				at: 1,
			},
			place: { paperId: "2", sectionId: "1", at: 777 },
			devices: [
				{ endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth, kinds: ["daily"] },
			],
		});
	});
});
