export type Env = {
	Bindings: {
		HYPERDRIVE?: Hyperdrive;
		DATABASE_URL?: string;
		OPENAI_API_KEY?: string;
		// PostHog project token (phc_). The logger sends to PostHog Logs when it is set.
		POSTHOG_KEY?: string;
		SUPABASE_URL?: string;
		// The service key of Supabase (secret). Used only to remove a sign-in when a reader deletes the account.
		SUPABASE_SERVICE_ROLE_KEY?: string;
		ADMIN_USER_IDS?: string;
		// ES256 private key for app tokens, as a JWK in JSON (secret). See src/lib/app-tokens.ts.
		APP_JWT_PRIVATE_JWK?: string;
		// Life of an app access token in seconds (wrangler.toml [vars]). Absent means 15 minutes.
		ACCESS_TOKEN_SECONDS?: string;
		// Comma-separated ids of our own apps (wrangler.toml [vars]). Not a secret.
		FIRST_PARTY_APP_IDS?: string;
		APP_LOGOS?: R2Bucket;
		SEARCH_CACHE?: KVNamespace;
		// Cloudflare GraphQL Analytics (read-only) — used by /admin/stats
		CF_ANALYTICS_API_TOKEN?: string;
		CF_ZONE_TAG?: string;
		// POST /feedback delivery — each one is optional, the row is saved regardless
		RESEND_API_KEY?: string;
		// The Resend key with sending access for accounts.urantiahub.com (secret). For the sign-in email
		// and the review notices. See accountsMailKey.
		ACCOUNTS_RESEND_API_KEY?: string;
		FEEDBACK_FROM?: string;
		// Sender of the app review notices (wrangler.toml [vars]). Falls back to FEEDBACK_FROM.
		APP_REVIEW_FROM?: string;
		// The secret of the Supabase "Send Email" hook (secret, "v1,whsec_…"). See src/routes/send-email-hook.ts.
		SEND_EMAIL_HOOK_SECRET?: string;
		// The sender of the sign-in email (wrangler.toml [vars]).
		SIGNIN_FROM?: string;
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
