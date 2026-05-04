import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";

describe("GET /audio/:ref", () => {
	it("returns 200 for valid globalId ref", async () => {
		const res = await get("/audio/1:2.0.1");
		expect(res.status).toBe(200);
	});

	it("response has { data: { id, audio } }", async () => {
		const res = await get("/audio/1:2.0.1");
		const { data } = await res.json();
		expect(Object.keys(data).sort()).toEqual(["audio", "id"].sort());
		expect(data.id).toBeString();
	});

	it("returns 200 for standardReferenceId ref", async () => {
		const res = await get("/audio/2:0.1");
		expect(res.status).toBe(200);
	});

	it("returns 404 for invalid ref format", async () => {
		const res = await get("/audio/not-a-ref");
		expect(res.status).toBe(404);
	});

	it("returns 404 for valid format but non-existent paragraph", async () => {
		const res = await get("/audio/999:999.999");
		expect(res.status).toBe(404);
	});
});
