export type Env = {
	Bindings: {
		HYPERDRIVE?: Hyperdrive;
		DATABASE_URL?: string;
		OPENAI_API_KEY?: string;
		LOGTAIL_TOKEN?: string;
		SUPABASE_URL?: string;
		ADMIN_USER_IDS?: string;
		APP_JWT_SECRET?: string;
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
	};
};
