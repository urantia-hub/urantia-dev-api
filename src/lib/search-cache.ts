const EMBEDDING_TTL_SECONDS = 30 * 24 * 60 * 60;
const COUNT_TTL_SECONDS = 7 * 24 * 60 * 60;

const EMBEDDING_KEY_VERSION = "v1";
const COUNT_KEY_VERSION = "v1";

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const buf = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function embeddingKey(query: string): Promise<string> {
	return `emb:${EMBEDDING_KEY_VERSION}:${await sha256Hex(query)}`;
}

function countKey(paperId: string | undefined, partId: string | undefined): string {
	return `count:${COUNT_KEY_VERSION}:${paperId ?? "*"}:${partId ?? "*"}`;
}

export async function getCachedEmbedding(
	kv: KVNamespace | undefined,
	query: string,
): Promise<number[] | null> {
	if (!kv) return null;
	try {
		return await kv.get<number[]>(await embeddingKey(query), "json");
	} catch {
		return null;
	}
}

export async function setCachedEmbedding(
	kv: KVNamespace | undefined,
	query: string,
	vector: number[],
): Promise<void> {
	if (!kv) return;
	try {
		await kv.put(await embeddingKey(query), JSON.stringify(vector), {
			expirationTtl: EMBEDDING_TTL_SECONDS,
		});
	} catch {
		// best-effort
	}
}

export async function getCachedCount(
	kv: KVNamespace | undefined,
	paperId: string | undefined,
	partId: string | undefined,
): Promise<number | null> {
	if (!kv) return null;
	try {
		const v = await kv.get(countKey(paperId, partId), "text");
		if (v === null) return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

export async function setCachedCount(
	kv: KVNamespace | undefined,
	paperId: string | undefined,
	partId: string | undefined,
	count: number,
): Promise<void> {
	if (!kv) return;
	try {
		await kv.put(countKey(paperId, partId), String(count), {
			expirationTtl: COUNT_TTL_SECONDS,
		});
	} catch {
		// best-effort
	}
}

/**
 * Schedules background work to run after the response is sent (on Workers via
 * `waitUntil`). Falls back to fire-and-forget in environments without an
 * execution context (local Bun dev).
 */
export function runAfter(
	c: { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } },
	promise: Promise<unknown>,
): void {
	try {
		const ctx = c.executionCtx;
		if (ctx && typeof ctx.waitUntil === "function") {
			ctx.waitUntil(promise);
			return;
		}
	} catch {
		// fall through
	}
	promise.catch(() => {});
}
