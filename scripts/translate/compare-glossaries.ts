import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const V1_PATH = join(ROOT, "data/translations/nl/entity-glossary.json");
const V2_PATH = join(ROOT, "data/translations/nl/entity-glossary-v2.json");
const OUTPUT_PATH = join(ROOT, "data/translations/nl/glossary-comparison.md");

type GlossaryEntry = {
	entityId: string;
	entityType: string;
	foundation: string;
	urantia_dev: string;
	confidence: string;
};

const v1: Record<string, GlossaryEntry> = JSON.parse(readFileSync(V1_PATH, "utf-8"));
const v2: Record<string, GlossaryEntry> = JSON.parse(readFileSync(V2_PATH, "utf-8"));

const allKeys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
const lines: string[] = [];

// Find diffs
type Diff = {
	entity: string;
	type: string;
	foundationV1: string;
	foundationV2: string;
	urantiaDevV1: string;
	urantiaDevV2: string;
	confidenceV1: string;
	confidenceV2: string;
};

const diffs: Diff[] = [];
const same: string[] = [];

for (const key of allKeys) {
	const e1 = v1[key];
	const e2 = v2[key];
	if (!e1 || !e2) continue;

	if (e1.urantia_dev !== e2.urantia_dev || e1.foundation !== e2.foundation) {
		diffs.push({
			entity: key,
			type: e1.entityType,
			foundationV1: e1.foundation,
			foundationV2: e2.foundation,
			urantiaDevV1: e1.urantia_dev,
			urantiaDevV2: e2.urantia_dev,
			confidenceV1: e1.confidence,
			confidenceV2: e2.confidence,
		});
	} else {
		same.push(key);
	}
}

// Only urantia.dev changed
const urantiaDevChanged = diffs.filter(
	(d) => d.urantiaDevV1 !== d.urantiaDevV2,
);
// Only foundation changed
const foundationChanged = diffs.filter(
	(d) => d.foundationV1 !== d.foundationV2,
);

lines.push("# Glossary Comparison: V1 (single paragraph) vs V2 (multi-paragraph)");
lines.push("");
lines.push(`Total entities: ${allKeys.size}`);
lines.push(`Identical between V1 and V2: ${same.length}`);
lines.push(`Different: ${diffs.length}`);
lines.push(`- urantia.dev translation changed: ${urantiaDevChanged.length}`);
lines.push(`- Foundation extraction changed: ${foundationChanged.length}`);
lines.push("");

// Confidence comparison
const v1High = Object.values(v1).filter((e) => e.confidence === "high").length;
const v2High = Object.values(v2).filter((e) => e.confidence === "high").length;
const v1Medium = Object.values(v1).filter((e) => e.confidence === "medium").length;
const v2Medium = Object.values(v2).filter((e) => e.confidence === "medium").length;
const v1Manual = Object.values(v1).filter((e) => e.confidence === "needs_manual").length;
const v2Manual = Object.values(v2).filter((e) => e.confidence === "needs_manual").length;

lines.push("## Confidence Comparison");
lines.push("");
lines.push("| Level | V1 (1 paragraph) | V2 (up to 5) |");
lines.push("|-------|-----------------|--------------|");
lines.push(`| High | ${v1High} | ${v2High} |`);
lines.push(`| Medium | ${v1Medium} | ${v2Medium} |`);
lines.push(`| Needs manual | ${v1Manual} | ${v2Manual} |`);
lines.push("");

// urantia.dev changes (the most interesting part)
if (urantiaDevChanged.length > 0) {
	lines.push("---");
	lines.push("");
	lines.push("## urantia.dev Translation Changes");
	lines.push("");
	lines.push("These are entities where the multi-paragraph context produced a different urantia.dev translation.");
	lines.push("");
	lines.push("| English | V1 (1 paragraph) | V2 (multi-paragraph) | Foundation |");
	lines.push("|---------|-----------------|---------------------|------------|");
	for (const d of urantiaDevChanged.sort((a, b) =>
		a.entity.localeCompare(b.entity),
	)) {
		lines.push(
			`| ${d.entity} | ${d.urantiaDevV1} | ${d.urantiaDevV2} | ${d.foundationV2} |`,
		);
	}
	lines.push("");
}

// Foundation extraction changes
if (foundationChanged.length > 0) {
	lines.push("---");
	lines.push("");
	lines.push("## Foundation Extraction Changes");
	lines.push("");
	lines.push("These are entities where multi-paragraph context changed the Foundation translation extraction.");
	lines.push("");
	lines.push("| English | Foundation V1 | Foundation V2 |");
	lines.push("|---------|--------------|--------------|");
	for (const d of foundationChanged.sort((a, b) =>
		a.entity.localeCompare(b.entity),
	)) {
		lines.push(`| ${d.entity} | ${d.foundationV1} | ${d.foundationV2} |`);
	}
	lines.push("");
}

// Unchanged list
lines.push("---");
lines.push("");
lines.push(`## Unchanged (${same.length} entities)`);
lines.push("");
lines.push(
	same
		.sort()
		.map((s) => `${s}`)
		.join(", "),
);
lines.push("");

writeFileSync(OUTPUT_PATH, lines.join("\n"));
console.log(`Comparison written to: ${OUTPUT_PATH}`);
console.log(`\n  Same: ${same.length} | Different: ${diffs.length} (urantia.dev changed: ${urantiaDevChanged.length}, foundation changed: ${foundationChanged.length})`);
