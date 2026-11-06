-- MCP tool calls for each day, by client family and tool. Bots are not counted.
-- urantia.dev/vision reads it through GET /stats/mcp-usage. Safe to run again.

CREATE TABLE IF NOT EXISTS mcp_daily_calls (
	day     date NOT NULL,
	family  text NOT NULL,
	tool    text NOT NULL,
	calls   integer NOT NULL DEFAULT 0,
	PRIMARY KEY (day, family, tool)
);

ALTER TABLE mcp_daily_calls ENABLE ROW LEVEL SECURITY;
