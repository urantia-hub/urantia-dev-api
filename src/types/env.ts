export type Env = {
	Bindings: {
		HYPERDRIVE?: Hyperdrive;
		DATABASE_URL?: string;
		OPENAI_API_KEY?: string;
		// PostHog project token (phc_). The logger sends to PostHog Logs when it is set.
		POSTHOG_KEY?: string;
		SUPABASE_URL?: string;
		ADMIN_USER_IDS?: string;
		APP_JWT_SECRET?: string;
		// Comma-separated ids of our own apps (wrangler.toml [vars]). Not a secret.
		FIRST_PARTY_APP_IDS?: string;
		APP_LOGOS?: R2Bucket;
		SEARCH_CACHE?: KVNamespace;
		// Cloudflare GraphQL Analytics (read-only) — used by /admin/stats
		CF_ANALYTICS_API_TOKEN?: string;
		CF_ZONE_TAG?: string;
		// POST /feedback delivery — each one is optional, the row is saved regardless
		RESEND_API_KEY?: string;
		FEEDBACK_FROM?: string;
		FEEDBACK_TO?: string;
		SLACK_FEEDBACK_WEBHOOK_URL?: string;
		FEEDBACK_IP_PEPPER?: string;
		// Token for OpenAI plugin domain verification (/.well-known/openai-apps-challenge)
		OPENAI_APPS_CHALLENGE?: string;
		// Per-client limiter for POST /feedback (Durable Object, wrangler.toml [[durable_objects.bindings]])
		FEEDBACK_LIMITER?: DurableObjectNamespace;
		// Coarse total-volume cap for POST /feedback (wrangler.toml [[ratelimits]])
		FEEDBACK_GLOBAL_LIMITER?: RateLimit;
	};
};
