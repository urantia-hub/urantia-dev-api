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

/** Reads the MCP body from a copy of the request, so the route still reads the original. */
export async function readMcpSummary(request: Request): Promise<McpSummary> {
	const length = Number(request.headers.get("content-length") ?? "0");
	if (length > 64_000) return {};
	try {
		return summarizeMcp(await request.clone().json());
	} catch {
		return {};
	}
}

/** The caller fields of a request log. The raw IP is never logged, only a keyed hash. */
export async function callerFields(headers: Headers, pepper: string | undefined) {
	const ip =
		headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	const userAgent = headers.get("user-agent") ?? undefined;
	const family = classifyUserAgent(userAgent);
	return {
		// No pepper means no hash: an unkeyed hash of an IPv4 address is reversible.
		ip_hash: ip && pepper ? (await hashIp(ip, pepper)).slice(0, 16) : undefined,
		country: headers.get("cf-ipcountry") ?? undefined,
		user_agent: userAgent,
		ua_family: family,
		is_bot: family === "bot-crawler",
	};
}
