import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const GLOSSARY_PATH = join(ROOT, "data/translations/nl/entity-glossary.json");

type GlossaryEntry = {
	entityId: string;
	entityType: string;
	aliases: string[];
	foundation: string;
	urantia_dev: string;
	confidence: "high" | "medium" | "needs_manual";
	source_ref: string | null;
};

type Glossary = Record<string, GlossaryEntry>;

const glossary: Glossary = JSON.parse(readFileSync(GLOSSARY_PATH, "utf-8"));
const entries = Object.entries(glossary);

console.log("=== Entity Glossary Validation Report (Dutch) ===\n");
console.log(`Total entries: ${entries.length}\n`);

// --- Confidence breakdown ---
const byConfidence = { high: 0, medium: 0, needs_manual: 0 };
for (const [, v] of entries) {
	byConfidence[v.confidence]++;
}
console.log("--- Confidence Distribution ---");
console.log(`  High:         ${byConfidence.high} (${pct(byConfidence.high)})`);
console.log(`  Medium:       ${byConfidence.medium} (${pct(byConfidence.medium)})`);
console.log(`  Needs manual: ${byConfidence.needs_manual} (${pct(byConfidence.needs_manual)})`);

// --- Type breakdown ---
const byType: Record<string, number> = {};
for (const [, v] of entries) {
	byType[v.entityType] = (byType[v.entityType] ?? 0) + 1;
}
console.log("\n--- Entity Type Distribution ---");
for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
	console.log(`  ${type}: ${count} (${pct(count)})`);
}

// --- Foundation vs urantia.dev comparison ---
const identical = entries.filter(([, v]) => v.foundation === v.urantia_dev);
const different = entries.filter(([, v]) => v.foundation !== v.urantia_dev);
console.log("\n--- Foundation vs urantia.dev ---");
console.log(`  Identical: ${identical.length} (${pct(identical.length)})`);
console.log(`  Different: ${different.length} (${pct(different.length)})`);

// --- Suspicious: concept/order entities with EN name = NL name ---
const suspiciousSameAsEnglish = entries.filter(
	([name, v]) =>
		(v.entityType === "concept" || v.entityType === "order") &&
		v.urantia_dev.toLowerCase() === name.toLowerCase(),
);
if (suspiciousSameAsEnglish.length > 0) {
	console.log(
		`\n--- Suspicious: Concepts/Orders unchanged from English (${suspiciousSameAsEnglish.length}) ---`,
	);
	for (const [name, v] of suspiciousSameAsEnglish) {
		console.log(`  "${name}" → "${v.urantia_dev}" [${v.confidence}]`);
	}
}

// --- Suspicious: foundation extraction looks wrong (too short or too long) ---
const suspiciousFoundation = entries.filter(
	([name, v]) => {
		const ratio = v.foundation.length / Math.max(name.length, 1);
		return ratio > 5 || (v.foundation.length < 3 && name.length > 3);
	},
);
if (suspiciousFoundation.length > 0) {
	console.log(
		`\n--- Suspicious: Foundation translations with unusual length (${suspiciousFoundation.length}) ---`,
	);
	for (const [name, v] of suspiciousFoundation) {
		console.log(
			`  "${name}" → foundation="${v.foundation}" [${v.confidence}]`,
		);
	}
}

// --- Needs manual review ---
const needsManual = entries.filter(([, v]) => v.confidence === "needs_manual");
if (needsManual.length > 0) {
	console.log(`\n--- Needs Manual Review (${needsManual.length}) ---`);
	for (const [name, v] of needsManual) {
		console.log(
			`  "${name}" (${v.entityType}): foundation="${v.foundation}" | urantia.dev="${v.urantia_dev}"`,
		);
	}
}

// --- Divergences (for wife review) ---
if (different.length > 0) {
	console.log(`\n--- All Divergences for Review (${different.length}) ---`);
	for (const [name, v] of different) {
		console.log(
			`  "${name}": foundation="${v.foundation}" → urantia.dev="${v.urantia_dev}" [${v.confidence}]`,
		);
	}
}

console.log("\n=== Validation Complete ===");

function pct(n: number): string {
	return `${((n / entries.length) * 100).toFixed(1)}%`;
}
