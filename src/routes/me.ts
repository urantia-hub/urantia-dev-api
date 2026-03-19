import { createApp } from "../lib/app.ts";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import type { AuthUser } from "../middleware/auth.ts";

export const meRoute = createApp();

// --- GET /me — User profile ---
const getProfileRoute = createRoute({
	operationId: "getProfile",
	method: "get",
	path: "/",
	tags: ["User"],
	summary: "Get authenticated user profile",
	description: "Returns the profile of the currently authenticated user.",
	responses: {
		200: {
			description: "User profile",
			content: {
				"application/json": {
					schema: z.object({
						data: z.object({
							id: z.string().uuid(),
							email: z.string().nullable(),
							name: z.string().nullable(),
							avatarUrl: z.string().nullable(),
						}),
					}),
				},
			},
		},
		401: {
			description: "Authentication required",
			content: { "application/json": { schema: z.object({ type: z.string(), title: z.string(), status: z.number(), detail: z.string() }) } },
		},
	},
});

meRoute.openapi(getProfileRoute, async (c) => {
	const user = c.get("user") as AuthUser;
	return c.json(
		{
			data: {
				id: user.id,
				email: user.email,
				name: user.name,
				avatarUrl: user.avatarUrl,
			},
		},
		200,
	);
});
