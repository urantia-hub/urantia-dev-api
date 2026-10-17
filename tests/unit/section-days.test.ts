import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
	parseSectionRows,
	type SectionDayStore,
	type SectionRow,
} from "../../src/lib/section-days.ts";
import { createStreakRoute } from "../../src/routes/streak.ts";

const ME = "00000000-0000-4000-8000-0000000000a1";
const row: SectionRow = { day: "2026-10-16", paperId: "3", sectionId: "4", how: "read" };

describe("parseSectionRows", () => {
	it("takes valid rows", () => {
		expect(parseSectionRows({ rows: [row] })).toEqual([row]);
		expect(
			parseSectionRows({ rows: [{ ...row, paperId: "0", sectionId: "0", how: "heard" }] }),
		).toEqual([{ ...row, paperId: "0", sectionId: "0", how: "heard" }]);
	});

	it("refuses the whole list for one bad row", () => {
		for (const bad of [
			{ ...row, day: "2026-13-01" },
			{ ...row, day: "2026-02-30" },
			{ ...row, day: "16-10-2026" },
			{ ...row, paperId: "197" },
			{ ...row, paperId: "-1" },
			{ ...row, paperId: "03" },
			{ ...row, sectionId: "a" },
			{ ...row, sectionId: "1000" },
			{ ...row, how: "skimmed" },
			"3:4",
			null,
		]) {
			expect(parseSectionRows({ rows: [row, bad] })).toBeNull();
		}
	});

	it("keeps one row for a section on a day, heard first", () => {
		expect(parseSectionRows({ rows: [row, { ...row, how: "heard" }, row] })).toEqual([
			{ ...row, how: "heard" },
		]);
	});

	it("refuses no rows and more than 50", () => {
		expect(parseSectionRows({ rows: [] })).toBeNull();
		expect(parseSectionRows({ rows: Array.from({ length: 51 }, () => row) })).toBeNull();
		const fifty = Array.from({ length: 50 }, (_, i) => ({ ...row, sectionId: String(i) }));
		expect(parseSectionRows({ rows: fifty })).toHaveLength(50);
		expect(parseSectionRows(null)).toBeNull();
		expect(parseSectionRows({})).toBeNull();
	});
});

function memory() {
	const rows: Array<SectionRow & { userId: string }> = [];
	const key = (r: SectionRow & { userId: string }) =>
		`${r.userId}|${r.day}|${r.paperId}|${r.sectionId}`;
	const store: SectionDayStore = {
		async add(userId, given) {
			let added = 0;
			for (const r of given) {
				const had = rows.find((x) => key(x) === key({ ...r, userId }));
				if (!had) {
					rows.push({ ...r, userId });
					added += 1;
				} else if (r.how === "heard") had.how = "heard";
			}
			return added;
		},
		async list(userId, since) {
			return rows
				.filter((r) => r.userId === userId && (since === null || r.day >= since))
				.map(({ userId: _, ...r }) => r);
		},
	};
	return { rows, store };
}

let world: ReturnType<typeof memory>;
let signedIn: string | null;

function build() {
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("user" as never, (signedIn ? { id: signedIn } : null) as never);
		await next();
	});
	app.route("/", createStreakRoute({ store: () => world.store }));
	return (method: string, path: string, json?: unknown) =>
		app.request(path, {
			method,
			headers: { "content-type": "application/json" },
			body: json === undefined ? undefined : JSON.stringify(json),
		});
}

beforeEach(() => {
	world = memory();
	signedIn = ME;
});

describe("the reader's finished sections", () => {
	it("answer 401 with no reader", async () => {
		signedIn = null;
		const call = build();
		expect((await call("GET", "/me/section-days")).status).toBe(401);
		expect((await call("POST", "/me/section-days", { rows: [row] })).status).toBe(401);
	});

	it("keep one row for a section on a day, and heard wins", async () => {
		const call = build();
		const first = await call("POST", "/me/section-days", { rows: [row] });
		expect((await first.json()) as unknown).toEqual({ data: { added: 1 } });
		const again = await call("POST", "/me/section-days", { rows: [{ ...row, how: "heard" }] });
		expect((await again.json()) as unknown).toEqual({ data: { added: 0 } });
		expect(world.rows).toHaveLength(1);
		expect(world.rows[0]?.how).toBe("heard");
	});

	it("refuse a list that is not valid", async () => {
		const call = build();
		const answer = await call("POST", "/me/section-days", { rows: [{ ...row, how: "x" }] });
		expect(answer.status).toBe(400);
		expect(world.rows).toHaveLength(0);
	});

	it("list the rows from a day on", async () => {
		const call = build();
		await call("POST", "/me/section-days", {
			rows: [row, { ...row, day: "2026-10-10", sectionId: "1" }],
		});
		const all = (await (await call("GET", "/me/section-days")).json()) as { data: unknown[] };
		expect(all.data).toHaveLength(2);
		const recent = (await (await call("GET", "/me/section-days?since=2026-10-15")).json()) as {
			data: unknown[];
		};
		expect(recent.data).toEqual([row]);
		expect((await call("GET", "/me/section-days?since=yesterday")).status).toBe(400);
	});
});
