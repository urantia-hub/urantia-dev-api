import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseFile } from "music-metadata";

const AUDIO_BASE =
	process.env.MP3_DIR ??
	join(import.meta.dir, "../../urantia-data-sources/data/audio/eng");

const CDN_BASE = "https://cdn.urantia.dev/audio/eng/paragraphs";
const LEGACY_CDN_BASE = "https://audio.urantia.dev";
const OUTPUT_PATH = join(import.meta.dir, "../data/audio-manifest.json");

// Ordered longest-first so longer prefixes match before shorter ones
const MODEL_PREFIXES = ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"] as const;

type AudioEntry = {
	format: string;
	url: string;
	duration?: number;
	bitrate?: number;
	fileSize?: number;
};

async function getAudioMetadata(filePath: string): Promise<{ duration?: number; bitrate?: number; fileSize?: number }> {
	try {
		const stat = statSync(filePath);
		const metadata = await parseFile(filePath);
		return {
			duration: metadata.format.duration ? Math.round(metadata.format.duration * 10) / 10 : undefined,
			bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) : undefined,
			fileSize: stat.size,
		};
	} catch {
		return {};
	}
}

type AudioManifest = Record<
	string, // globalId
	Record<
		string, // model
		Record<string, AudioEntry> // voice -> entry
	>
>;

function parseFilename(
	filename: string,
): { model: string; voice: string; globalId: string } | null {
	if (!filename.endsWith(".mp3")) return null;

	const stem = filename.slice(0, -4); // strip .mp3

	for (const prefix of MODEL_PREFIXES) {
		if (!stem.startsWith(`${prefix}-`)) continue;

		// After the model prefix + hyphen, the rest is "voice-globalId"
		const remainder = stem.slice(prefix.length + 1);

		// The voice is the next token before the first hyphen that precedes the globalId.
		// globalId starts with a digit (e.g. "0:0.0.1") or "Part" (e.g. "Part1").
		// Voice names are alphabetic (alloy, echo, fable, nova, onyx, shimmer).
		const hyphenIdx = remainder.indexOf("-");
		if (hyphenIdx === -1) return null;

		const voice = remainder.slice(0, hyphenIdx);
		const globalId = remainder.slice(hyphenIdx + 1);

		if (!voice || !globalId) return null;

		return { model: prefix, voice, globalId };
	}

	return null;
}

async function generateManifest(): Promise<void> {
	if (!existsSync(AUDIO_BASE)) {
		console.error(`Audio directory not found: ${AUDIO_BASE}`);
		process.exit(1);
	}

	console.log(`Scanning: ${AUDIO_BASE}`);

	const manifest: AudioManifest = {};
	let parsed = 0;
	let skipped = 0;

	// Scan legacy flat directory (audio/eng/*.mp3)
	const flatEntries = readdirSync(AUDIO_BASE);
	for (const entry of flatEntries) {
		const result = parseFilename(entry);
		if (!result) {
			skipped++;
			continue;
		}

		const { model, voice, globalId } = result;
		const filePath = join(AUDIO_BASE, entry);
		const meta = await getAudioMetadata(filePath);

		manifest[globalId] ??= {};
		manifest[globalId][model] ??= {};
		manifest[globalId][model][voice] = {
			format: "mp3",
			url: `${LEGACY_CDN_BASE}/${entry}`,
			...meta,
		};
		parsed++;
	}

	// Scan voice subdirectories (audio/eng/paragraphs/{voice}/*.mp3)
	const paragraphsDir = join(AUDIO_BASE, "paragraphs");
	if (existsSync(paragraphsDir)) {
		const voiceDirs = readdirSync(paragraphsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);

		for (const voiceDir of voiceDirs) {
			const voicePath = join(paragraphsDir, voiceDir);
			const voiceEntries = readdirSync(voicePath);
			for (const entry of voiceEntries) {
				const result = parseFilename(entry);
				if (!result) {
					skipped++;
					continue;
				}

				const { model, voice, globalId } = result;

				// Only add if not already present (flat dir takes precedence for legacy compat)
				if (!manifest[globalId]?.[model]?.[voice]) {
					const filePath = join(voicePath, entry);
					const meta = await getAudioMetadata(filePath);

					manifest[globalId] ??= {};
					manifest[globalId][model] ??= {};
					manifest[globalId][model][voice] = {
						format: "mp3",
						url: `${CDN_BASE}/${voiceDir}/${entry}`,
						...meta,
					};
					parsed++;
				} else {
					skipped++;
				}
			}
		}
	}

	// Sort manifest keys for deterministic output
	const sorted: AudioManifest = {};
	for (const globalId of Object.keys(manifest).sort()) {
		const models = manifest[globalId];
		if (!models) continue;
		sorted[globalId] = {};
		for (const model of Object.keys(models).sort()) {
			const voices = models[model];
			if (!voices) continue;
			sorted[globalId][model] = {};
			for (const voice of Object.keys(voices).sort()) {
				const entry = voices[voice];
				if (!entry) continue;
				sorted[globalId][model][voice] = entry;
			}
		}
	}

	const outputDir = dirname(OUTPUT_PATH);
	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}

	writeFileSync(OUTPUT_PATH, `${JSON.stringify(sorted, null, 2)}\n`);

	console.log(`Parsed: ${parsed} files`);
	console.log(`Skipped: ${skipped} entries (non-mp3 or unparseable)`);
	console.log(`Unique globalIds: ${Object.keys(sorted).length}`);
	console.log(`Written to: ${OUTPUT_PATH}`);
}

generateManifest().catch(console.error);
