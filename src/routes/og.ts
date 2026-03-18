import { createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { ImageResponse } from "workers-og";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { detectRefFormat } from "../types/node.ts";
import { ErrorResponse, ParagraphRefParam } from "../validators/schemas.ts";

export const ogRoute = createApp();

const ThemeEnum = z.enum(["default", "warm", "purple", "minimal"]);

const OgQuery = z.object({
  theme: ThemeEnum.default("default"),
});

const THEME_COLORS: Record<
  z.infer<typeof ThemeEnum>,
  { glow: string; accent: string }
> = {
  default: { glow: "rgba(59, 130, 246, 0.15)", accent: "#3b82f6" },
  warm: { glow: "rgba(245, 158, 11, 0.15)", accent: "#f59e0b" },
  purple: { glow: "rgba(139, 92, 246, 0.15)", accent: "#8b5cf6" },
  minimal: { glow: "transparent", accent: "#6b7280" },
};

function truncateText(text: string, maxLength = 280): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

const getOgRoute = createRoute({
  operationId: "getOgImage",
  method: "get",
  path: "/{ref}",
  tags: ["OG Images"],
  summary: "Generate a dynamic Open Graph image for a passage",
  description: `Returns a 1200×630 PNG Open Graph image for a Urantia Book passage. Designed for social media previews.

Optional \`?theme=\` parameter: \`default\` (blue), \`warm\` (amber), \`purple\`, \`minimal\` (no glow).

Images are cached permanently (\`Cache-Control: immutable\`).`,
  request: {
    params: ParagraphRefParam,
    query: OgQuery,
  },
  responses: {
    200: {
      description: "PNG image",
    },
    404: {
      description: "Paragraph not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

ogRoute.openapi(getOgRoute, async (c) => {
  const { db } = getDb(c.env?.HYPERDRIVE);
  const { ref } = c.req.valid("param");
  const { theme } = c.req.valid("query");
  const format = detectRefFormat(ref);

  if (format === "unknown") {
    return problemJson(c, 404, `Invalid paragraph reference: "${ref}"`);
  }

  const col =
    format === "globalId"
      ? paragraphs.globalId
      : format === "standardReferenceId"
        ? paragraphs.standardReferenceId
        : paragraphs.paperSectionParagraphId;

  const result = await db
    .select({
      standardReferenceId: paragraphs.standardReferenceId,
      text: paragraphs.text,
      paperTitle: paragraphs.paperTitle,
    })
    .from(paragraphs)
    .where(eq(col, ref))
    .limit(1);

  if (result.length === 0) {
    return problemJson(c, 404, `Paragraph "${ref}" not found`);
  }

  const row = result[0]!;
  const colors = THEME_COLORS[theme];
  const displayText = truncateText(row.text);

  const html = `<div style="display:flex;flex-direction:column;width:1200px;height:630px;background:#0a0b0f;padding:60px;font-family:system-ui,sans-serif;position:relative;overflow:hidden">
		<div style="display:flex;position:absolute;top:0;left:0;width:600px;height:630px;background:radial-gradient(circle at 0% 50%,${colors.glow},transparent 70%)"></div>
		<div style="display:flex;flex-direction:column;flex:1;z-index:1">
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:24px">
				<div style="display:flex;padding:6px 14px;background:${colors.accent};border-radius:6px;color:white;font-size:18px;font-weight:600">${row.standardReferenceId}</div>
				<div style="display:flex;color:#9ca3af;font-size:18px">${row.paperTitle}</div>
			</div>
			<div style="display:flex;flex:1;align-items:center">
				<div style="display:flex;color:white;font-size:28px;line-height:1.5;max-height:340px;overflow:hidden">${displayText}</div>
			</div>
		</div>
		<div style="display:flex;justify-content:flex-end;z-index:1">
			<div style="display:flex;color:#4b5563;font-size:16px">The Urantia Papers</div>
		</div>
	</div>`;

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
  });
});
