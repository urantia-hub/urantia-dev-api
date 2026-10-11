-- The notices of UrantiaHub: the devices of a reader, and the log of what was sent.
-- Run one time on the database, with Kelson's approval. Safe to run again.

CREATE TABLE IF NOT EXISTS push_subscriptions (
	id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	endpoint    text NOT NULL UNIQUE,
	p256dh      text NOT NULL,
	auth        text NOT NULL,
	kinds       text[] NOT NULL DEFAULT '{}'::text[],
	label       text NOT NULL DEFAULT '',
	created_at  timestamp NOT NULL DEFAULT now(),
	last_ok_at  timestamp
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS notice_log (
	user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind     text NOT NULL,
	key      text NOT NULL,
	channel  text NOT NULL,
	sent_at  timestamp NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, kind, key, channel)
);
CREATE INDEX IF NOT EXISTS notice_log_sent_at_idx ON notice_log (sent_at);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notice_log         ENABLE ROW LEVEL SECURITY;
