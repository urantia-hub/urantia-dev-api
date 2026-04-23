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
	};
};
