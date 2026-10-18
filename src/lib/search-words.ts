import { type SQL, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { normalizedSql } from "./search-text.ts";

export type Db = ReturnType<typeof getDb>["db"];

// A word list of plain values for SQL, one parameter for each word (no array type needed).
export const textArray = (words: string[]): SQL =>
	sql`array[${sql.join(
		words.map((w) => sql`${w}::text`),
		sql`, `,
	)}]::text[]`;

// Only this many words of a query get a typo check, so a long query does not start one query for each word.
const MAX_CHECKED = 12;

/**
 * The normalized text of a row, as SQL. It is no column: each table has a trigram index on this
 * expression (scripts/setup-search.sql), so it must stay the same text for the index to be used.
 */
export const matchText = (column: string): SQL => sql.raw(normalizedSql(column));

/** The letters of a word in order, so two words with a swap of two letters compare equal. */
const letters = (word: string) => [...word].sort().join("");

/**
 * The words of a query with each unknown word of 4 letters or more changed to the closest word of
 * the source: same first letter, edit distance 1 (4 letters) or 2 (5 or more), a swap of two
 * letters counts as 1, and a more common word wins a tie. Only the first 12 such words. With `prefixLast`, a last word that
 * starts a known word stays. Null when no word changed.
 */
export async function correctWords(
	db: Db,
	source: string | string[],
	words: string[],
	prefixLast: boolean,
): Promise<string[] | null> {
	const last = words.length - 1;
	const inSource = sql`source = any(${textArray(Array.isArray(source) ? source : [source])})`;
	const checked = words
		.map((word, i) => (word.length < 4 || /^[0-9]+$/.test(word) ? -1 : i))
		.filter((i) => i >= 0)
		.slice(0, MAX_CHECKED);
	const fixes = await Promise.all(
		words.map(async (word, i) => {
			if (!checked.includes(i)) return null;
			const prefix = prefixLast && i === last;
			const max = word.length === 4 ? 1 : 2;
			const rows = (await db.execute(sql`
				with known as (
					select 1 from search_words where ${inSource}
					and (word = ${word} or (${prefix} and word like ${`${word}%`}))
					limit 1
				)
				select word as fix from (
					select word, n, levenshtein(word, ${word}) - case when length(word) = ${word.length}
						and array_to_string(array(select unnest(string_to_array(word, null)) order by 1), '') = ${letters(word)}
						then 1 else 0 end as d
					from search_words
					where ${inSource} and not exists (select 1 from known)
					and left(word, 1) = ${word[0]} and abs(length(word) - ${word.length}) <= 2
					and levenshtein(word, ${word}) <= 2
				) c
				where d <= ${max}
				order by d, n desc limit 1`)) as unknown as { fix: string }[];
			return rows[0]?.fix ?? null;
		}),
	);
	const out = words.map((word, i) => fixes[i] ?? word);
	const changed = out.some((word, i) => word !== words[i]);
	return changed ? out : null;
}
