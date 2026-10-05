import captured from "./openapi-examples.json";

// The parts of the generated spec that this file reads and writes.
type Media = { schema?: unknown; example?: unknown };
type Response = {
	description?: string;
	headers?: Record<string, unknown>;
	content?: Record<string, Media>;
};
type Parameter = { name?: string; in?: string; example?: unknown };
type Operation = {
	parameters?: Parameter[];
	responses?: Record<string, Response>;
	requestBody?: { content?: Record<string, Media> };
	security?: Record<string, string[]>[];
};
type Spec = {
	security?: Record<string, string[]>[];
	paths?: Record<string, Record<string, Operation>>;
	components?: Record<string, Record<string, unknown>>;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const PROBLEM_REF = { $ref: "#/components/schemas/ProblemDetails" };
const RATE_LIMIT_HEADERS = {
	"X-RateLimit-Limit": { $ref: "#/components/headers/X-RateLimit-Limit" },
	"X-RateLimit-Remaining": { $ref: "#/components/headers/X-RateLimit-Remaining" },
	"X-RateLimit-Reset": { $ref: "#/components/headers/X-RateLimit-Reset" },
};

// Request bodies for the signed-in write operations. Each one is valid against its schema.
const REQUEST_EXAMPLES: Record<string, unknown> = {
	"put /me": { name: "Reader" },
	"post /me/bookmarks": { ref: "2:5.1", category: "Love" },
	"post /me/notes": { ref: "2:5.1", text: "Compare with 1 John 4:8.", format: "plain" },
	"put /me/notes/{id}": { text: "Compare with 1 John 4:8 and 4:16.", format: "plain" },
	"post /me/reading-progress": { refs: ["2:5.1", "2:5.2"] },
	"post /feedback": {
		category: "docs",
		message: "The quickstart does not say that q is required for /search.",
		endpoint: "/search",
	},
};

// A real value for each parameter name that means the same thing on every operation.
const PARAMETER_EXAMPLES: Record<string, unknown> = {
	ref: "2:5.1",
	paperId: "2",
	bookCode: "MAT",
	chapter: 5,
	verse: 3,
};

const EXAMPLES = captured as Record<string, { request?: unknown; response: unknown }>;

// Operations under these paths need a signed-in user. The rest of /auth is public.
const PUBLIC_AUTH = new Set([
	"get /auth/apps/{id}",
	"get /auth/apps/{id}/logo",
	"post /auth/token",
	"post /auth/refresh",
]);

function needsUser(key: string, path: string): boolean {
	if (path === "/me" || path.startsWith("/me/")) return true;
	return path.startsWith("/auth/") && !PUBLIC_AUTH.has(key);
}

function setExample(content: Record<string, Media> | undefined, example: unknown) {
	const media = content?.["application/json"];
	if (media && example !== undefined) media.example = example;
}

/** Adds the facts the route definitions do not carry: errors, rate limits, auth, and examples. */
export function finalizeOpenApi<T>(document: T): T {
	const spec = document as Spec;
	spec.components ??= {};
	spec.components.schemas = {
		...spec.components.schemas,
		ProblemDetails: {
			type: "object",
			description: "An RFC 9457 problem details object. Every error response uses it.",
			properties: {
				type: { type: "string", format: "uri", description: "A URI that names the error type." },
				title: { type: "string", description: "The short name of the status." },
				status: { type: "integer", description: "The HTTP status code." },
				detail: { type: "string", description: "What went wrong in this request." },
			},
			required: ["type", "title", "status", "detail"],
			example: {
				type: "https://urantia.dev/errors/not-found",
				title: "Not Found",
				status: 404,
				detail: "Paragraph not found",
			},
		},
	};
	spec.components.headers = {
		...spec.components.headers,
		"X-RateLimit-Limit": {
			description: "The number of requests allowed in the current window.",
			schema: { type: "integer" },
			example: 200,
		},
		"X-RateLimit-Remaining": {
			description: "The number of requests left in the current window.",
			schema: { type: "integer" },
			example: 199,
		},
		"X-RateLimit-Reset": {
			description: "The time the window resets, in Unix seconds.",
			schema: { type: "integer" },
			example: 1791152213,
		},
	};
	spec.components.securitySchemes = {
		...spec.components.securitySchemes,
		bearerAuth: {
			type: "http",
			scheme: "bearer",
			bearerFormat: "JWT",
			description:
				"An access token for a signed-in user. Only the /me and /auth operations use it. Every other operation needs no key.",
		},
	};

	// No key is needed unless an operation says so.
	spec.security ??= [];

	for (const [path, item] of Object.entries(spec.paths ?? {})) {
		for (const method of METHODS) {
			const operation = item[method];
			if (!operation) continue;
			const key = `${method} ${path}`;
			operation.responses ??= {};

			// The rate limiter runs before every route.
			operation.responses["429"] ??= { description: "Too many requests" };
			if (needsUser(key, path)) {
				operation.security = [{ bearerAuth: [] }];
				operation.responses["401"] ??= { description: "Missing or invalid access token" };
			}

			for (const [status, response] of Object.entries(operation.responses)) {
				response.headers = { ...response.headers, ...RATE_LIMIT_HEADERS };
				if (status.startsWith("4") || status.startsWith("5")) {
					response.content = { "application/problem+json": { schema: PROBLEM_REF } };
				}
			}

			for (const parameter of operation.parameters ?? []) {
				const value = parameter.name ? PARAMETER_EXAMPLES[parameter.name] : undefined;
				if (value !== undefined) parameter.example ??= value;
			}

			const example = EXAMPLES[key];
			if (example) setExample(operation.responses["200"]?.content, example.response);
			setExample(operation.requestBody?.content, example?.request ?? REQUEST_EXAMPLES[key]);
		}
	}

	return document;
}
