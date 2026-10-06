import { hashIp } from "./feedback-delivery.ts";
import { classifyUserAgent } from "./ua-family.ts";

export type McpSummary = {
	mcp_method?: string;
	mcp_tool?: string;
	mcp_client?: string;
	mcp_client_version?: string;
};

type RpcMessage = {
	method?: unknown;
	params?: { name?: unknown; clientInfo?: { name?: unknown; version?: unknown } };
};

const short = (value: unknown, max = 80) =>
	typeof value === "string" && value ? value.slice(0, max) : undefined;

/** What an MCP request asked for: the method, the tool, and the client that sent it. */
export function summarizeMcp(body: unknown): McpSummary {
	const messages = (Array.isArray(body) ? body : [body]).filter(
		(m): m is RpcMessage => !!m && typeof m === "object",
	);
	const methods = messages.map((m) => short(m.method)).filter(Boolean);
	const tools = messages
		.filter((m) => m.method === "tools/call")
		.map((m) => short(m.params?.name))
		.filter(Boolean);
	const init = messages.find((m) => m.method === "initialize");
	return {
		mcp_method: methods.length ? methods.join(",") : undefined,
		mcp_tool: tools.length ? tools.join(",") : undefined,
		mcp_client: short(init?.params?.clientInfo?.name),
		mcp_client_version: short(init?.params?.clientInfo?.version, 40),
	};
}

const MAX_MCP_BODY = 64_000;

/** Reads at most `max` bytes of a stream. Returns undefined when the body is longer. */
async function readCapped(stream: ReadableStream<Uint8Array>, max: number) {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

/** Reads the MCP body from a copy, so the route still reads the original. */
export async function readMcpSummary(request: Request): Promise<McpSummary> {
	// A stated length over the cap is skipped at once. Any body is also read with a
	// hard byte cap, so a missing or false length cannot make this read unbounded.
	const length = Number(request.headers.get("content-length") ?? "0");
	if (length > MAX_MCP_BODY) return {};
	const copy = request.clone().body;
	if (!copy) return {};
	try {
		const text = await readCapped(copy, MAX_MCP_BODY);
		return text === undefined ? {} : summarizeMcp(JSON.parse(text));
	} catch {
		return {};
	}
}

/** The Monday of this UTC week, as YYYY-MM-DD. The log hash changes every week. */
export function weekOf(now: Date): string {
	const day = (now.getUTCDay() + 6) % 7;
	const monday = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day),
	);
	return monday.toISOString().slice(0, 10);
}

/** The caller fields of a request log. The raw IP is never logged, only a keyed hash. */
export async function callerFields(
	headers: Headers,
	pepper: string | undefined,
	now: Date = new Date(),
) {
	const ip =
		headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	const userAgent = headers.get("user-agent") ?? undefined;
	const family = classifyUserAgent(userAgent);
	return {
		// No pepper means no hash: an unkeyed hash of an IPv4 address is reversible.
		// Its own key, so a log line never matches the hash on a feedback row, and the
		// week in the input, so a caller can be counted within a week but not followed across weeks.
		ip_hash:
			ip && pepper
				? (await hashIp(`${ip}|${weekOf(now)}`, `${pepper}:request-log`)).slice(0, 16)
				: undefined,
		country: headers.get("cf-ipcountry") ?? undefined,
		user_agent: userAgent,
		ua_family: family,
		is_bot: family === "bot-crawler",
	};
}
