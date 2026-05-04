#!/usr/bin/env bun
/**
 * Debug why DELETE /me/bookmarks/:ref returns 404 when the bookmark exists.
 *
 * Usage:
 *   bun run scripts/debug-bookmark-delete.ts <userEmail> <ref>
 *
 * Example:
 *   bun run scripts/debug-bookmark-delete.ts kelson@portalhq.io 1:0.1
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/db/client.ts";
import { bookmarks, paragraphs, users } from "../src/db/schema.ts";
import { resolveParagraphRef } from "../src/lib/paragraph-lookup.ts";

const [, , email, ref] = process.argv;
if (!email || !ref) {
	console.error("Usage: bun run scripts/debug-bookmark-delete.ts <userEmail> <ref>");
	process.exit(1);
}

const { db } = getDb();

console.log(`\n=== Debug: DELETE bookmark for user=${email} ref=${ref} ===\n`);

// 1. Look up the user
const userRows = await db.select().from(users).where(eq(users.email, email)).limit(5);
console.log(`Users matching email:`, userRows.length);
for (const u of userRows) {
	console.log(`  - id=${u.id} email=${u.email} createdAt=${u.createdAt}`);
}
if (userRows.length === 0) {
	console.error("No user found with that email.");
	process.exit(1);
}
const userId = userRows[0]!.id;

// 2. Resolve the ref like the server does
const resolved = await resolveParagraphRef(db, ref);
console.log(`\nresolveParagraphRef("${ref}"):`, resolved ? `globalId=${resolved.globalId}` : "NULL");

// 3. Show ALL paragraphs with this standardReferenceId (to detect duplicates)
const paras = await db
	.select({
		id: paragraphs.id,
		globalId: paragraphs.globalId,
		standardReferenceId: paragraphs.standardReferenceId,
		language: paragraphs.language,
	})
	.from(paragraphs)
	.where(eq(paragraphs.standardReferenceId, ref));
console.log(`\nParagraphs with standardReferenceId="${ref}":`, paras.length);
for (const p of paras) {
	console.log(`  - id=${p.id} globalId=${p.globalId} lang=${p.language}`);
}

// 4. Show all bookmarks for this user
const userBookmarks = await db
	.select()
	.from(bookmarks)
	.where(eq(bookmarks.userId, userId));
console.log(`\nBookmarks for user ${userId}:`, userBookmarks.length);
for (const b of userBookmarks) {
	console.log(
		`  - id=${b.id} paragraphId="${b.paragraphId}" paperId=${b.paperId} appId=${b.appId} createdAt=${b.createdAt.toISOString()}`,
	);
}

// 5. Run the exact DELETE query (as a SELECT) to see what DELETE would match
if (resolved) {
	const wouldDelete = await db
		.select()
		.from(bookmarks)
		.where(and(eq(bookmarks.userId, userId), eq(bookmarks.paragraphId, resolved.globalId)));
	console.log(
		`\nBookmarks matching (userId=${userId}, paragraphId="${resolved.globalId}"):`,
		wouldDelete.length,
	);
	for (const b of wouldDelete) {
		console.log(`  - id=${b.id}`);
	}
}

process.exit(0);
