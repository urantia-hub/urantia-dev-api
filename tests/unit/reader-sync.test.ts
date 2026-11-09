import { describe, expect, it } from "bun:test";
import {
	READER_DELETIONS_DAYS,
	SYNC_OVERLAP_MS,
	sinceProblem,
	syncedAtFor,
} from "../../src/lib/reader-sync.ts";

const now = new Date("2026-11-09T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

describe("sinceProblem", () => {
	it("accepts a time inside the window", () => {
		expect(sinceProblem(daysAgo(1), now)).toBeNull();
		expect(sinceProblem(daysAgo(READER_DELETIONS_DAYS), now)).toBeNull();
		expect(sinceProblem(now, now)).toBeNull();
	});

	// The deletes before the window are gone, so the answer could not list each one.
	it("refuses a time before the window", () => {
		expect(sinceProblem(daysAgo(READER_DELETIONS_DAYS + 1), now)?.status).toBe(410);
	});

	it("refuses a time in the future and a time that is not one", () => {
		expect(sinceProblem(new Date(now.getTime() + 60_000), now)?.status).toBe(400);
		expect(sinceProblem(new Date("not a time"), now)?.detail).toContain("ISO 8601");
	});
});

describe("syncedAtFor", () => {
	// A write that ends during the read must come again in the next sync.
	it("is before the time of the read", () => {
		expect(now.getTime() - syncedAtFor(now).getTime()).toBe(SYNC_OVERLAP_MS);
	});
});
