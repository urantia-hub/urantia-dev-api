import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { apps } from "../db/schema.ts";
import type { AppStatus } from "./app-status.ts";
import { type ChangeRequest, parseRequest, type Reviewed } from "./change-request.ts";

type Db = ReturnType<typeof getDb>["db"];

// The statements of an edit and of a review. Each is one statement that decides from the row as it is
// at that moment: a route reads the app first, and an admin can approve or suspend it between the read
// and the write. So no statement here writes a status, or a reviewed value, on the word of that read.

const textArray = (values: readonly string[]): SQL =>
	values.length === 0
		? sql`array[]::text[]`
		: sql`array[${sql.join(
				values.map((value) => sql`${value}`),
				sql`, `,
			)}]::text[]`;

export type Edit = {
	name?: string;
	redirectUris?: readonly string[];
	scopes?: readonly string[];
	// A new logo. A removal of the logo is not an edit of this kind: it needs no review.
	logoUrl?: string;
	primaryColor?: string | null;
	accentColor?: string | null;
};

// Writes an edit. For an approved app the reviewed values stay as they are, and "request" is kept
// for a reviewer. A removal of an address or a permission holds at once; only an edit that would leave
// a list empty leaves that list as it is, so the app keeps working. For any other app the
// values are live at once, and a declined app goes to review again.
// "request": the request for this edit, null for none, or undefined when the edit touches no reviewed
// field (the colors only), so a request that waits is left alone.
export async function writeEdit(
	db: Db,
	id: string,
	input: { wanted: Edit; request: ChangeRequest | null | undefined; byAdmin: boolean },
): Promise<{ status: string; pendingChange: ChangeRequest | null } | null> {
	const { wanted, request } = input;
	const byAdmin = sql`${input.byAdmin}::boolean`;
	// Held: the app is approved, so what is new waits for a reviewer.
	const held = sql`(${apps.status} = 'approved' and not ${byAdmin})`;
	const again = sql`(${apps.status} = 'declined' and ${request != null}::boolean and not ${byAdmin})`;
	// The items that the app has now and that the edit keeps, in the order that the app has.
	const kept = (column: SQLWrapper, values: readonly string[]) =>
		sql`array(select item from unnest(${column}) with ordinality as had(item, place) where item = any(${textArray(values)}) order by place)`;

	// A removal holds at once. If nothing of the list would stay, the list stays, so the app still works.
	const cut = (column: SQLWrapper, values: readonly string[]) =>
		sql`case when cardinality(${kept(column, values)}) = 0 then ${column} else ${kept(column, values)} end`;

	const sets: SQL[] = [];
	if (wanted.name !== undefined) {
		sets.push(sql`name = case when ${held} then ${apps.name} else ${wanted.name} end`);
	}
	if (wanted.redirectUris !== undefined) {
		sets.push(
			sql`redirect_uris = case when ${held} then ${cut(apps.redirectUris, wanted.redirectUris)} else ${textArray(wanted.redirectUris)} end`,
		);
	}
	if (wanted.scopes !== undefined) {
		sets.push(
			sql`scopes = case when ${held} then ${cut(apps.scopes, wanted.scopes)} else ${textArray(wanted.scopes)} end`,
		);
	}
	if (wanted.logoUrl !== undefined) {
		sets.push(sql`logo_url = case when ${held} then ${apps.logoUrl} else ${wanted.logoUrl} end`);
	}
	if (wanted.primaryColor !== undefined) sets.push(sql`primary_color = ${wanted.primaryColor}`);
	if (wanted.accentColor !== undefined) sets.push(sql`accent_color = ${wanted.accentColor}`);
	if (request !== undefined) {
		const json = request ? sql`${JSON.stringify(request)}::jsonb` : sql`null::jsonb`;
		sets.push(sql`pending_change = case when ${held} then ${json} else null end`);
		// A note of the reviewer was about the version before this edit.
		sets.push(
			sql`review_note = case when ${again} or (${held} and ${request !== null}::boolean) then null else ${apps.reviewNote} end`,
		);
		sets.push(sql`status = case when ${again} then 'pending' else ${apps.status} end`);
	}
	if (sets.length === 0) sets.push(sql`name = ${apps.name}`);

	const rows = await db.execute(
		sql`update ${apps} set ${sql.join(sets, sql`, `)} where ${apps.id} = ${id} returning status, pending_change`,
	);
	const row = rows[0] as { status: string; pending_change: unknown } | undefined;
	return row ? { status: row.status, pendingChange: parseRequest(row.pending_change) } : null;
}

// The reviewer's decision on a change request. False when the request that the reviewer saw is not
// the one that is stored now: the developer changed or withdrew it, or the app is not approved now.
export async function decideChange(
	db: Db,
	id: string,
	changeId: string,
	decision:
		| {
				decision: "approve";
				values: {
					name: string;
					redirectUris: readonly string[];
					scopes: readonly string[];
					logoUrl: string | null;
				};
		  }
		| { decision: "decline"; note: string },
): Promise<boolean> {
	const same = sql`${apps.id} = ${id} and ${apps.pendingChange}->>'id' = ${changeId}`;
	const rows =
		decision.decision === "approve"
			? await db.execute(sql`
					update ${apps} set
						name = ${decision.values.name},
						redirect_uris = ${textArray(decision.values.redirectUris)},
						scopes = ${textArray(decision.values.scopes)},
						logo_url = ${decision.values.logoUrl},
						pending_change = null, review_note = null, reviewed_at = now()
					where ${same} and ${apps.status} = 'approved'
					returning id`)
			: await db.execute(sql`
					update ${apps} set pending_change = null, review_note = ${decision.note}, reviewed_at = now()
					where ${same}
					returning id`);
	return rows.length > 0;
}

// The developer takes the request back. False when it is not the request that is stored now.
export async function withdrawChange(db: Db, id: string, changeId: string): Promise<boolean> {
	const rows = await db.execute(
		sql`update ${apps} set pending_change = null where ${apps.id} = ${id} and ${apps.pendingChange}->>'id' = ${changeId} returning id`,
	);
	return rows.length > 0;
}

// The status that a reviewer sets. An approval names what the reviewer's screen showed, and holds
// only if the app is still that at the moment of the write. False when it is not, or the app is gone.
export async function setReviewStatus(
	db: Db,
	id: string,
	input: { status: AppStatus; note: string | null; seen?: Reviewed },
): Promise<boolean> {
	const asSeen =
		input.status === "approved" && input.seen
			? sql` and ${apps.name} = ${input.seen.name}
					and ${apps.redirectUris} = ${textArray(input.seen.redirectUris)}
					and ${apps.scopes} = ${textArray(input.seen.scopes)}
					and ${apps.logoUrl} is not distinct from ${input.seen.logoUrl}`
			: sql``;
	const rows = await db.execute(sql`
		update ${apps} set status = ${input.status}, review_note = ${input.note}, reviewed_at = now()
		where ${apps.id} = ${id}${asSeen}
		returning id`);
	return rows.length > 0;
}
