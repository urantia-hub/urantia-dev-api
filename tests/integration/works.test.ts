import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";

const ip = { "cf-connecting-ip": "203.0.113.46" };

describe("GET /works/{work}/{ref}", () => {
	it("reads a Bible verse", async () => {
		const res = await get("/works/bible/John%203:16", ip);
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data[0].reference).toBe("John 3:16");
	});

	it("answers 404 for a work that does not exist", async () => {
		expect((await get("/works/nope/John%203:16", ip)).status).toBe(404);
		expect((await get("/works/nope/John%203:16/urantia-parallels", ip)).status).toBe(404);
	});
});
