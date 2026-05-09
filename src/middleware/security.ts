import type { MiddlewareHandler } from "hono";

/**
 * Block common vulnerability scanner probe paths early,
 * before CORS / logging / rate-limiting run.
 */

// /admin is intentionally NOT here — it's a real route, gated by ADMIN_USER_IDS
// in src/routes/admin.ts. Non-admin requests get 404 from the route handler,
// so scanner probes still see "not found" without breaking legit admin access.
const blockedPrefixes = new Set([
	"/wp-admin",
	"/wp-login",
	"/wp-content",
	"/wp-includes",
	"/phpmyadmin",
	"/cgi-bin",
	"/backup",
	"/config",
	"/debug",
	"/server-status",
	"/server-info",
	"/actuator",
]);

const blockedExtensions = /\.(php|asp|aspx|jsp|cgi)$/i;

export const scannerBlock: MiddlewareHandler = async (c, next) => {
	const path = c.req.path;

	// Block dotfile paths (/.env, /.git/config, etc.) but allow /.well-known
	if (path.startsWith("/.") && !path.startsWith("/.well-known")) {
		return c.json({ error: "Not found" }, 404);
	}

	// Block known scanner target prefixes
	for (const prefix of blockedPrefixes) {
		if (path === prefix || path.startsWith(`${prefix}/`)) {
			return c.json({ error: "Not found" }, 404);
		}
	}

	// Block file extension probes
	if (blockedExtensions.test(path)) {
		return c.json({ error: "Not found" }, 404);
	}

	await next();
};
