/**
 * translations.ts — Shared helpers for overlaying translations onto query results
 */

import { eq, and, sql } from "drizzle-orm";
import {
	paragraphs,
	paragraphTranslations,
	entityTranslations,
	titleTranslations,
} from "../db/schema.ts";

/** What a reader must know about a translated paragraph: a machine made it, and it is CC0. */
export type TranslationLabel = {
	method: "machine";
	license: "CC0-1.0";
	review: string | null;
};

/**
 * Overlay translated text/htmlText onto paragraph results.
 * Returns the original paragraph with `text`, `htmlText`, and `language` replaced
 * if a translation exists, with a `translation` label. Falls back to English with `language: "eng"`.
 */
export async function applyParagraphTranslations<T extends { id: string; text: string; htmlText?: string }>(
	db: any,
	paragraphs: T[],
	lang: string,
): Promise<(T & { language: string; translation?: TranslationLabel })[]> {
	if (!lang || lang === "eng" || paragraphs.length === 0) {
		return paragraphs.map((p) => ({ ...p, language: "eng" }));
	}

	// Batch-fetch translations for all paragraph IDs
	const paraIds = paragraphs.map((p) => p.id);
	const translations = await db
		.select({
			paragraphId: paragraphTranslations.paragraphId,
			text: paragraphTranslations.text,
			htmlText: paragraphTranslations.htmlText,
			confidence: paragraphTranslations.confidence,
		})
		.from(paragraphTranslations)
		.where(
			and(
				sql`${paragraphTranslations.paragraphId} IN (${sql.join(paraIds.map((id) => sql`${id}`), sql`, `)})`,
				eq(paragraphTranslations.language, lang),
			),
		);

	const translationMap = new Map(
		// biome-ignore lint: Drizzle select result type
		translations.map((t: any) => [t.paragraphId, t]),
	);

	return paragraphs.map((p) => {
		const translation = translationMap.get(p.id) as
			| { text: string; htmlText: string; confidence: string | null }
			| undefined;
		if (translation) {
			return {
				...p,
				text: translation.text,
				// MCP rows carry no htmlText, so they get none.
				...("htmlText" in p ? { htmlText: translation.htmlText } : {}),
				language: lang,
				translation: { method: "machine", license: "CC0-1.0", review: translation.confidence },
			};
		}
		return { ...p, language: "eng" }; // fallback
	});
}

/**
 * Overlay translated name/aliases/description onto entity results.
 */
export async function applyEntityTranslations<T extends { id: string; name: string; aliases: string[] | null; description: string | null }>(
	db: any,
	entities: T[],
	lang: string,
): Promise<(T & { language: string; translation?: TranslationLabel })[]> {
	if (!lang || lang === "eng" || entities.length === 0) {
		return entities.map((e) => ({ ...e, language: "eng" }));
	}

	const entityIds = entities.map((e) => e.id);
	const translations = await db
		.select({
			entityId: entityTranslations.entityId,
			name: entityTranslations.name,
			aliases: entityTranslations.aliases,
			description: entityTranslations.description,
		})
		.from(entityTranslations)
		.where(
			and(
				sql`${entityTranslations.entityId} IN (${sql.join(entityIds.map((id) => sql`${id}`), sql`, `)})`,
				eq(entityTranslations.language, lang),
				eq(entityTranslations.source, "urantia.dev"),
			),
		);

	const translationMap = new Map(
		// biome-ignore lint: Drizzle select result type
		translations.map((t: any) => [t.entityId, t]),
	);

	return entities.map((e) => {
		const translation = translationMap.get(e.id) as { name: string; aliases: string[] | null; description: string | null } | undefined;
		if (translation) {
			return {
				...e,
				name: translation.name,
				aliases: translation.aliases ?? e.aliases,
				description: translation.description ?? e.description,
				language: lang,
			};
		}
		return { ...e, language: "eng" };
	});
}

/**
 * Overlay translated paper/section titles onto results that have paperTitle/sectionTitle.
 * A section title is keyed by "paperId.sectionId"; a part title by its part id.
 */
export async function applyTitleTranslations<T extends { paperId: string; paperTitle: string; sectionTitle: string | null }>(
	db: any,
	paragraphs: T[],
	lang: string,
): Promise<T[]> {
	if (!lang || lang === "eng" || paragraphs.length === 0) {
		return paragraphs;
	}

	// Collect unique paper and section IDs
	const paperIds = [...new Set(paragraphs.map((p) => p.paperId))];

	const translations = await db
		.select({
			sourceType: titleTranslations.sourceType,
			sourceId: titleTranslations.sourceId,
			title: titleTranslations.title,
		})
		.from(titleTranslations)
		.where(
			and(
				sql`split_part(${titleTranslations.sourceId}, '.', 1) IN (${sql.join(paperIds.map((id) => sql`${id}`), sql`, `)})`,
				eq(titleTranslations.language, lang),
			),
		);

	const titleMap = new Map(
		// biome-ignore lint: Drizzle select result type
		translations.map((t: any) => [`${t.sourceType}:${t.sourceId}`, t.title]),
	);

	return paragraphs.map((p) => {
		const paperTitle = titleMap.get(`paper:${p.paperId}`) ?? p.paperTitle;
		const sectionId = (p as { sectionId?: string | null }).sectionId;
		const sectionTitle =
			(sectionId != null && titleMap.get(`section:${p.paperId}.${sectionId}`)) || p.sectionTitle;
		return { ...p, paperTitle, sectionTitle };
	});
}

/**
 * Translated titles of one kind ("paper", "section", "part", "part-sponsorship"), keyed by source id.
 * Empty for English, so a caller can always fall back to the English value.
 */
export async function loadTitleMap(
	db: any,
	lang: string | undefined,
	sourceTypes: string[],
): Promise<Map<string, string>> {
	if (!lang || lang === "eng") return new Map();
	const rows = await db
		.select({
			sourceType: titleTranslations.sourceType,
			sourceId: titleTranslations.sourceId,
			title: titleTranslations.title,
		})
		.from(titleTranslations)
		.where(
			and(
				eq(titleTranslations.language, lang),
				sql`${titleTranslations.sourceType} IN (${sql.join(sourceTypes.map((t) => sql`${t}`), sql`, `)})`,
			),
		);
	// biome-ignore lint: Drizzle select result type
	return new Map(rows.map((t: any) => [`${t.sourceType}:${t.sourceId}`, t.title]));
}

/** Translated entity names by entity id. Empty for English or for no ids. */
export async function loadEntityNames(db: any, ids: string[], lang: string): Promise<Map<string, string>> {
	if (!lang || lang === "eng" || ids.length === 0) return new Map();
	const rows = await db
		.select({ entityId: entityTranslations.entityId, name: entityTranslations.name })
		.from(entityTranslations)
		.where(
			and(
				sql`${entityTranslations.entityId} IN (${sql.join([...new Set(ids)].map((id) => sql`${id}`), sql`, `)})`,
				eq(entityTranslations.language, lang),
				eq(entityTranslations.source, "urantia.dev"),
			),
		);
	// biome-ignore lint: Drizzle select result type
	return new Map(rows.map((r: any) => [r.entityId, r.name]));
}

type IncludedParallel = { id: string; paperId: string; paperTitle: string; sectionTitle: string | null; text: string };
type IncludedEntity = { id: string; name: string };

/**
 * Overlays a language on the included parts of paragraph rows: the text and titles of each
 * Papers parallel, and the name of each entity mention. The Bible and the other works stay English.
 * An item with no translation keeps its English and gets `language: "eng"`.
 */
export async function localizeIncluded<T extends { urantiaParallels?: IncludedParallel[]; entities?: IncludedEntity[] }>(
	db: any,
	rows: T[],
	lang: string,
): Promise<T[]> {
	if (!lang || lang === "eng") return rows;
	const mentions = rows.flatMap((r) => r.entities ?? []);
	const parallels = rows.flatMap((r) => r.urantiaParallels ?? []);
	if (mentions.length === 0 && parallels.length === 0) return rows;

	const names = await loadEntityNames(db, mentions.map((e) => e.id), lang);

	const localized = new Map<string, Record<string, unknown>>();
	if (parallels.length > 0) {
		const ids = [...new Set(parallels.map((p) => p.id))];
		// A parallel carries no sectionId. The column holds "paper.section"; the title key needs the section part.
		const sectionRows = await db
			.select({ id: paragraphs.id, sectionId: paragraphs.sectionId })
			.from(paragraphs)
			.where(sql`${paragraphs.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
		// biome-ignore lint: Drizzle select result type
		const sectionOf = new Map<string, string | null>(sectionRows.map((r: any) => [r.id, r.sectionId?.split(".").pop() ?? null]));
		const unique = ids.map((id) => parallels.find((p) => p.id === id)!);
		const texts = await applyParagraphTranslations(db, unique.map((p) => ({ id: p.id, text: p.text })), lang);
		const titles = await applyTitleTranslations(
			db,
			unique.map((p) => ({ paperId: p.paperId, paperTitle: p.paperTitle, sectionTitle: p.sectionTitle, sectionId: sectionOf.get(p.id) ?? null })),
			lang,
		);
		unique.forEach((p, i) => {
			const { text, language, translation } = texts[i]!;
			const { paperTitle, sectionTitle } = titles[i]!;
			localized.set(p.id, { text, paperTitle, sectionTitle, language, ...(translation ? { translation } : {}) });
		});
	}

	return rows.map((r) => {
		const out = { ...r };
		if (r.entities) {
			out.entities = r.entities.map((e) => {
				const name = names.get(e.id);
				return name ? { ...e, name, language: lang } : { ...e, language: "eng" };
			});
		}
		if (r.urantiaParallels) {
			out.urantiaParallels = r.urantiaParallels.map((p) => ({ ...p, ...localized.get(p.id) }));
		}
		return out;
	});
}
