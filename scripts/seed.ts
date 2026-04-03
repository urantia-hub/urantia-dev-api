import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { paragraphs, papers, parts, sections } from "../src/db/schema.ts";
import type { RawJsonNode } from "../src/types/node.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const DATA_DIR =
  process.env.DATA_DIR ??
  join(import.meta.dir, "../../urantia-data-sources/data/json/eng");

const MANIFEST_PATH =
  process.env.AUDIO_MANIFEST ??
  join(import.meta.dir, "../data/audio-manifest.json");

const VIDEO_MANIFEST_PATH =
  process.env.VIDEO_MANIFEST ??
  join(import.meta.dir, "../data/video-manifest.json");

let audioManifest: Record<string, Record<string, Record<string, { format: string; url: string }>>> = {};
if (existsSync(MANIFEST_PATH)) {
  audioManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  console.log(`Audio manifest loaded: ${Object.keys(audioManifest).length} paragraphs`);
} else {
  console.warn(`Audio manifest not found at ${MANIFEST_PATH} — audio will be null`);
}

let videoManifest: Record<string, Record<string, { mp4: string; thumbnail: string; duration: number }>> = {};
if (existsSync(VIDEO_MANIFEST_PATH)) {
  videoManifest = JSON.parse(readFileSync(VIDEO_MANIFEST_PATH, "utf-8"));
  console.log(`Video manifest loaded: ${Object.keys(videoManifest).length} papers`);
} else {
  console.warn(`Video manifest not found at ${VIDEO_MANIFEST_PATH} — video will be null`);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function seed() {
  console.log(`Seeding from: ${DATA_DIR}`);

  // --- 1. Seed parts ---
  console.log("\n--- Seeding parts ---");

  // Foreword part (part 0)
  await db
    .insert(parts)
    .values({
      id: "0",
      title: "Foreword",
      sponsorship: null,
      sortId: "0.000.000.000",
    })
    .onConflictDoNothing();
  console.log("  Inserted part 0 (Foreword)");

  // Parts 1-4
  for (const partNum of [1, 2, 3, 4]) {
    const filePath = join(DATA_DIR, `${partNum}-part.json`);
    const nodes: RawJsonNode[] = JSON.parse(readFileSync(filePath, "utf-8"));
    const partNode = nodes.find((n) => n.type === "part");

    if (partNode) {
      await db
        .insert(parts)
        .values({
          id: partNode.partId,
          title: partNode.partTitle ?? `Part ${partNum}`,
          sponsorship: partNode.partSponsorship ?? null,
          sortId: partNode.sortId,
        })
        .onConflictDoNothing();
      console.log(`  Inserted part ${partNode.partId}: ${partNode.partTitle}`);
    }
  }

  // --- 2. Seed papers, sections, and paragraphs ---
  console.log("\n--- Seeding papers, sections, and paragraphs ---");

  const allFiles = readdirSync(DATA_DIR);
  const paperFiles = allFiles.filter((f) => /^\d{3}\.json$/.test(f)).sort();

  let totalPapers = 0;
  let totalSections = 0;
  let totalParagraphs = 0;

  for (const file of paperFiles) {
    const filePath = join(DATA_DIR, file);
    const nodes: RawJsonNode[] = JSON.parse(readFileSync(filePath, "utf-8"));

    // Insert paper node
    const paperNode = nodes.find((n) => n.type === "paper");
    if (paperNode && paperNode.paperId) {
      await db
        .insert(papers)
        .values({
          id: paperNode.paperId,
          partId: paperNode.partId,
          title: paperNode.paperTitle ?? `Paper ${paperNode.paperId}`,
          globalId: paperNode.globalId,
          sortId: paperNode.sortId,
          labels: paperNode.labels ?? [],
          video: videoManifest[paperNode.paperId] ?? null,
        })
        .onConflictDoNothing();
      totalPapers++;
    }

    // Insert section nodes
    const sectionNodes = nodes.filter((n) => n.type === "section");
    for (const sn of sectionNodes) {
      if (sn.paperSectionId) {
        await db
          .insert(sections)
          .values({
            id: sn.paperSectionId,
            paperId: sn.paperId!,
            sectionId: sn.sectionId!,
            title: sn.sectionTitle ?? null,
            globalId: sn.globalId,
            sortId: sn.sortId,
          })
          .onConflictDoNothing();
        totalSections++;
      }
    }

    // Insert paragraph nodes in batches
    const paraNodes = nodes.filter(
      (n) => n.type === "paragraph" && n.text && n.htmlText,
    );

    const values = paraNodes.map((p) => ({
      id: p.globalId,
      globalId: p.globalId,
      standardReferenceId: p.standardReferenceId!,
      paperSectionParagraphId: p.paperSectionParagraphId!,
      sortId: p.sortId,
      paperId: p.paperId!,
      sectionId: p.paperSectionId ?? null,
      partId: p.partId,
      paperTitle: p.paperTitle ?? "",
      sectionTitle: p.sectionTitle ?? null,
      paragraphId: p.paragraphId!,
      language: p.language ?? "eng",
      text: p.text!,
      htmlText: p.htmlText!,
      labels: p.labels ?? [],
      audio: audioManifest[p.globalId] ?? null,
    }));

    // Batch insert in chunks of 500
    for (let i = 0; i < values.length; i += 500) {
      const batch = values.slice(i, i + 500);
      await db.insert(paragraphs).values(batch).onConflictDoNothing();
    }

    totalParagraphs += paraNodes.length;
    console.log(
      `  ${file}: ${paraNodes.length} paragraphs, ${sectionNodes.length} sections`,
    );
  }

  console.log("\n--- Seed complete ---");
  console.log(`  Parts: 5`);
  console.log(`  Papers: ${totalPapers}`);
  console.log(`  Sections: ${totalSections}`);
  console.log(`  Paragraphs: ${totalParagraphs}`);

  await client.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
