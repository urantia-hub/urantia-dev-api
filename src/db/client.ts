import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

// Accepts an optional Hyperdrive binding for pooled connections on Cloudflare
// Workers. Falls back to DATABASE_URL for local development.
export function getDb(hyperdrive?: Hyperdrive) {
	const connectionString =
		hyperdrive?.connectionString ?? process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("No database connection string available");
	}
	const client = postgres(connectionString, {
		prepare: false,
		max: 1,
		idle_timeout: 2,
		fetch_types: false,
	});
	return { db: drizzle(client, { schema }) };
}
