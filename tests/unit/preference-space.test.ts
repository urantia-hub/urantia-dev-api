import { describe, expect, it } from "bun:test";
import { preferenceSpace } from "../../src/lib/preference-space.ts";

const stored = {
	"hub.place": { paperId: "2" },
	"hub.reader": { theme: "dark" },
	"hub.notices": { email: { daily: true } },
	"app:voices:theme": "light",
	"app:other:theme": "blue",
	theme: "old",
};

describe("the preferences that a caller can reach", () => {
	it("are the keys of the Hub for one of our own apps, and never the notice settings", () => {
		const space = preferenceSpace({ id: "urantiahub-app", firstParty: true });
		expect(space.visible(stored)).toEqual({
			"hub.place": { paperId: "2" },
			"hub.reader": { theme: "dark" },
		});
		expect(
			space.patch({ "hub.place": 1, "hub.notices": 2, theme: 3, "app:voices:theme": 4 }),
		).toEqual({ "hub.place": 1 });
	});

	it("are only its own keys for another app, under its plain names", () => {
		const space = preferenceSpace({ id: "voices", firstParty: false });
		expect(space.visible(stored)).toEqual({ theme: "light" });
		expect(
			space.patch({ theme: "dark", "hub.place": { paperId: "9" }, "hub.notices": {} }),
		).toEqual({
			"app:voices:theme": "dark",
			"app:voices:hub.place": { paperId: "9" },
			"app:voices:hub.notices": {},
		});
	});

	it("keep two apps apart, also when the id of one starts with the id of the other", () => {
		const all = { "app:voices:theme": "a", "app:voices2:theme": "b", "app:voices:x.theme": "c" };
		expect(preferenceSpace({ id: "voices", firstParty: false }).visible(all)).toEqual({
			theme: "a",
			"x.theme": "c",
		});
		expect(preferenceSpace({ id: "voices2", firstParty: false }).visible(all)).toEqual({
			theme: "b",
		});
	});

	it("are all but the notice settings for the reader on the accounts site", () => {
		const space = preferenceSpace(null);
		expect(Object.keys(space.visible(stored))).not.toContain("hub.notices");
		expect(Object.keys(space.visible(stored))).toHaveLength(5);
		expect(space.patch({ "hub.notices": 1, theme: 2 })).toEqual({ theme: 2 });
	});
});
