// Rebuilds the public Postman collection from the live spec, checks that every request
// returns 200, and replaces the published collection when it changed.
// Run: POSTMAN_API_KEY=... POSTMAN_COLLECTION_UID=... bun scripts/postman-sync.ts [--dry-run]
// --dry-run builds and checks only, and writes the file to postman-collection.json.
import { buildCollection } from "./postman-collection.ts";

const BASE = "https://api.urantia.dev";
const UA = { "User-Agent": "urantia-dev-api/postman-sync" };
const dryRun = process.argv.includes("--dry-run");

const spec = (await (await fetch(`${BASE}/openapi.json`, { headers: UA })).json()) as Parameters<
	typeof buildCollection
>[0];
const collection = buildCollection(spec);
const requests = collection.item.flatMap((f) => f.item);
console.log(`Built ${requests.length} requests in ${collection.item.length} folders`);

// Every request must run as is.
const failures: string[] = [];
for (const r of requests) {
	const req = r.request as { method: string; url: { raw: string }; body?: { raw: string } };
	const url = req.url.raw.replace("{{baseUrl}}", BASE);
	const res = await fetch(url, {
		method: req.method,
		headers: { ...UA, "Content-Type": "application/json" },
		body: req.body?.raw,
	});
	if (res.status !== 200) failures.push(`${res.status} ${req.method} ${url}`);
	await res.arrayBuffer();
	await new Promise((resolve) => setTimeout(resolve, 300));
}
if (failures.length) {
	console.error(`Requests that did not return 200:\n${failures.join("\n")}`);
	process.exit(1);
}
console.log("Every request returned 200");

if (dryRun) {
	await Bun.write("postman-collection.json", `${JSON.stringify(collection, null, 2)}\n`);
	console.log("Dry run: wrote postman-collection.json");
	process.exit(0);
}

const key = process.env.POSTMAN_API_KEY;
const uid = process.env.POSTMAN_COLLECTION_UID;
if (!key || !uid) throw new Error("POSTMAN_API_KEY and POSTMAN_COLLECTION_UID are required");
const api = `https://api.getpostman.com/collections/${uid}`;
const headers = { "X-Api-Key": key, "Content-Type": "application/json" };

// Compare the parts this script owns; Postman adds ids of its own to each item.
const strip = (c: unknown) =>
	JSON.stringify(c, (k, v) =>
		["_postman_id", "id", "uid", "_exporter_id", "updatedAt"].includes(k) ? undefined : v,
	);
const current = await fetch(api, { headers });
if (!current.ok) throw new Error(`Postman GET ${current.status}: ${await current.text()}`);
const published = ((await current.json()) as { collection: unknown }).collection;
const shape = (c: {
	info: { name: string; description: unknown };
	item: unknown;
	variable: unknown;
}) =>
	strip({ name: c.info.name, description: c.info.description, item: c.item, variable: c.variable });
if (shape(published as never) === shape(collection)) {
	console.log("Postman is already up to date");
	process.exit(0);
}
const put = await fetch(api, { method: "PUT", headers, body: JSON.stringify({ collection }) });
if (!put.ok) throw new Error(`Postman PUT ${put.status}: ${await put.text()}`);
console.log(`Updated the Postman collection: ${requests.length} requests`);
