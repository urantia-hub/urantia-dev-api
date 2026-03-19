import { app } from "../../src/index.ts";

export function get(path: string, headers?: Record<string, string>) {
	return app.request(path, { method: "GET", headers });
}

export function post(
	path: string,
	body: unknown,
	headers?: Record<string, string>,
) {
	return app.request(path, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

export function put(
	path: string,
	body: unknown,
	headers?: Record<string, string>,
) {
	return app.request(path, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

export function del(path: string, headers?: Record<string, string>) {
	return app.request(path, { method: "DELETE", headers });
}

export function options(path: string, headers?: Record<string, string>) {
	return app.request(path, { method: "OPTIONS", headers });
}
