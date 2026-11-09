import { describe, expect, it } from "bun:test";
import { buildExport, type ExportParts } from "../../src/lib/reader-export.ts";

const at = new Date("2026-11-09T12:00:00Z");
const empty: ExportParts = {
	account: null,
	bookmarks: [],
	notes: [],
	readingProgress: [],
	preferences: null,
	appData: [],
	appsAllowed: [],
	ownApps: [],
	devices: [],
	sectionDays: [],
	noticesSent: [],
};

describe("buildExport", () => {
	it("names its version and its time", () => {
		const out = buildExport(empty, at);
		expect(out.version).toBe(1);
		expect(out.exportedAt).toBe("2026-11-09T12:00:00.000Z");
	});

	it("writes each time as ISO 8601", () => {
		const out = buildExport({ ...empty, bookmarks: [{ id: "b", createdAt: at }] }, at);
		expect(out.bookmarks).toEqual([{ id: "b", createdAt: "2026-11-09T12:00:00.000Z" }]);
	});

	// The file must survive JSON: a reader opens it in any tool.
	it("is plain JSON", () => {
		const out = buildExport({ ...empty, notes: [{ id: "n", text: "a note", createdAt: at }] }, at);
		expect(JSON.parse(JSON.stringify(out))).toEqual(out);
	});
});
