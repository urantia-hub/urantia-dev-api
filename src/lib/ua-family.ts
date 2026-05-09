/**
 * Coarse user-agent classification for /admin/stats.
 *
 * Raw user-agent strings can fingerprint individual callers, so the admin
 * stats endpoint only ever exposes the family bucket — never the raw UA.
 */
export type UAFamily =
	| "claude-code"
	| "claude"
	| "openai"
	| "anthropic-sdk"
	| "mcp-client"
	| "browser"
	| "sdk-fetch"
	| "bot-crawler"
	| "unknown";

const PATTERNS: Array<{ family: UAFamily; re: RegExp }> = [
	{ family: "claude-code", re: /claude[-_ ]?code/i },
	{ family: "anthropic-sdk", re: /anthropic-(sdk|ai|python|typescript|node)/i },
	{ family: "openai", re: /openai|gpt-?[0-9]|chatgpt/i },
	{ family: "claude", re: /\b(claude|anthropic)\b/i },
	{ family: "mcp-client", re: /\bmcp\b|model[-_ ]?context[-_ ]?protocol/i },
	{ family: "bot-crawler", re: /\b(bot|crawler|spider|scraper|googlebot|bingbot)\b/i },
	{ family: "browser", re: /mozilla\/5\.0|chrome\/|safari\/|firefox\/|edge\//i },
	{
		family: "sdk-fetch",
		re: /^(curl|wget|node-fetch|undici|axios|got|python-requests|httpx|okhttp)/i,
	},
];

export function classifyUserAgent(ua: string | null | undefined): UAFamily {
	if (!ua) return "unknown";
	for (const { family, re } of PATTERNS) {
		if (re.test(ua)) return family;
	}
	return "unknown";
}
