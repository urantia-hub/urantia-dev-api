import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const GLOSSARY_PATH = join(ROOT, "data/translations/nl/entity-glossary.json");
const OUTPUT_PATH = join(ROOT, "data/translations/nl/entity-glossary-review.md");

type GlossaryEntry = {
	entityId: string;
	entityType: string;
	aliases: string[];
	foundation: string;
	urantia_dev: string;
	confidence: "high" | "medium" | "needs_manual";
	source_ref: string | null;
};

const glossary: Record<string, GlossaryEntry> = JSON.parse(
	readFileSync(GLOSSARY_PATH, "utf-8"),
);

const entries = Object.entries(glossary);
const identical = entries.filter(([, v]) => v.foundation === v.urantia_dev);
const different = entries.filter(([, v]) => v.foundation !== v.urantia_dev);
const needsManual = entries.filter(([, v]) => v.confidence === "needs_manual");

const lines: string[] = [];

lines.push("# Dutch Entity Translation Review");
lines.push("");
lines.push(`${entries.length} entities total | ${identical.length} identical | ${different.length} different | ${needsManual.length} need review`);
lines.push("");

// Section 1: Needs manual review
if (needsManual.length > 0) {
	lines.push("---");
	lines.push("");
	lines.push("## Needs Review");
	lines.push("");
	for (const [name, v] of needsManual) {
		lines.push(`**${name}** (${v.entityType})`);
		lines.push(`- Foundation: ${v.foundation}`);
		lines.push(`- urantia.dev: ${v.urantia_dev}`);
		lines.push("");
	}
}

// Section 2: Different translations
if (different.length > 0) {
	lines.push("---");
	lines.push("");
	lines.push("## Different Translations");
	lines.push("");
	lines.push("| English | Foundation (NL) | urantia.dev (NL) |");
	lines.push("|---------|----------------|-------------------|");
	for (const [name, v] of different.sort((a, b) => a[0].localeCompare(b[0]))) {
		lines.push(`| ${name} | ${v.foundation} | ${v.urantia_dev} |`);
	}
	lines.push("");
}

// Section 3: Identical translations
if (identical.length > 0) {
	lines.push("---");
	lines.push("");
	lines.push("## Identical Translations");
	lines.push("");
	lines.push("| English | Dutch |");
	lines.push("|---------|-------|");
	for (const [name, v] of identical.sort((a, b) => a[0].localeCompare(b[0]))) {
		lines.push(`| ${name} | ${v.urantia_dev} |`);
	}
	lines.push("");
}

writeFileSync(OUTPUT_PATH, lines.join("\n"));
console.log(`Review file written to: ${OUTPUT_PATH}`);
