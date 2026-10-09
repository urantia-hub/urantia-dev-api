import { z } from "zod";
import { isWebLink } from "../lib/app-status.ts";

// Each permission of the service. The consent screen of the accounts site has plain words for each
// name here and for no other name, so an app can register and ask for these only.
export const ALLOWED_SCOPES = [
	"profile",
	"bookmarks",
	"notes",
	"reading-progress",
	"preferences",
	"app-data",
];

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #6366f1");

export const AppCreateBody = z.object({
	id: z
		.string()
		.min(3)
		.max(40)
		.regex(
			/^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
			"Must be lowercase alphanumeric with hyphens, 3-40 chars",
		),
	name: z.string().trim().min(1).max(100),
	redirectUris: z.array(z.string().min(1)).min(1),
	scopes: z.array(z.enum(ALLOWED_SCOPES as [string, ...string[]])).min(1),
	primaryColor: HexColor.optional(),
	accentColor: HexColor.optional(),
	// For the admin's review: what the app does, and where it is.
	description: z.string().trim().max(1000).optional(),
	websiteUrl: z.string().trim().max(300).refine(isWebLink, "Must be an https address.").optional(),
});
