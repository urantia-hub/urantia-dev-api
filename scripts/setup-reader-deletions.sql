-- The bookmarks and notes that a reader deleted, so ?since= on /me/bookmarks and /me/notes can list them.
-- Run one time on the database, with Kelson's approval. Safe to run again.

CREATE TABLE IF NOT EXISTS reader_deletions (
	id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind          text NOT NULL,
	item_id       uuid NOT NULL,
	paragraph_id  text NOT NULL,
	deleted_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reader_deletions_user_kind_at_idx ON reader_deletions (user_id, kind, deleted_at);

ALTER TABLE reader_deletions ENABLE ROW LEVEL SECURITY;
