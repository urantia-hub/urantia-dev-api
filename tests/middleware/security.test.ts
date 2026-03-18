import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";

describe("Scanner blocking middleware", () => {
	it("blocks /.env", async () => {
		const res = await get("/.env");
		expect(res.status).toBe(404);
	});

	it("blocks /.git/config", async () => {
		const res = await get("/.git/config");
		expect(res.status).toBe(404);
	});

	it("blocks /.aws/credentials", async () => {
		const res = await get("/.aws/credentials");
		expect(res.status).toBe(404);
	});

	it("blocks /wp-admin", async () => {
		const res = await get("/wp-admin");
		expect(res.status).toBe(404);
	});

	it("blocks /wp-admin/install.php", async () => {
		const res = await get("/wp-admin/install.php");
		expect(res.status).toBe(404);
	});

	it("blocks /phpmyadmin", async () => {
		const res = await get("/phpmyadmin");
		expect(res.status).toBe(404);
	});

	it("blocks .php file extensions", async () => {
		const res = await get("/index.php");
		expect(res.status).toBe(404);
	});

	it("blocks .asp file extensions", async () => {
		const res = await get("/default.asp");
		expect(res.status).toBe(404);
	});

	it("allows /.well-known paths through", async () => {
		const res = await get("/.well-known/openid-configuration");
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.detail).toContain("no authentication");
	});

	it("allows legitimate API paths", async () => {
		const res = await get("/");
		expect(res.status).toBe(200);
	});
});
