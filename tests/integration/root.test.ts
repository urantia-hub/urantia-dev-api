import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";

describe("GET /", () => {
	it("returns 200", async () => {
		const res = await get("/");
		expect(res.status).toBe(200);
	});

	it("returns exactly { name, version, docs, openapi }", async () => {
		const res = await get("/");
		const json = await res.json();
		expect(Object.keys(json).sort()).toEqual(
			["docs", "name", "openapi", "version"].sort(),
		);
		expect(json.name).toBe("Urantia Papers API");
		expect(json.version).toBe("1.0.0");
		expect(json.docs).toBe("/docs");
		expect(json.openapi).toBe("/openapi.json");
	});
});

describe("GET /robots.txt", () => {
	it("returns 200 with text content", async () => {
		const res = await get("/robots.txt");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("User-agent");
	});
});

describe("GET /sitemap.xml", () => {
	it("returns 200 with XML content", async () => {
		const res = await get("/sitemap.xml");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("<?xml");
		expect(text).toContain("<urlset");
	});
});

describe("icons", () => {
	it("serves the mark as SVG at /favicon.svg", async () => {
		const res = await get("/favicon.svg");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("image/svg+xml");
		expect(await res.text()).toContain("<svg");
	});

	for (const path of ["/icon.png", "/favicon.ico"]) {
		it(`serves a 256 px PNG at ${path}`, async () => {
			const res = await get(path);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("image/png");
			const bytes = new Uint8Array(await res.arrayBuffer());
			// PNG signature, then the IHDR width and height (bytes 16-23).
			expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
			const view = new DataView(bytes.buffer);
			expect([view.getUint32(16), view.getUint32(20)]).toEqual([256, 256]);
		});
	}
});
