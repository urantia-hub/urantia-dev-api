-- The streak of UrantiaHub: the sections that a reader finished on each reading day.
-- Run one time on the database, with Kelson's approval. Safe to run again.

CREATE TABLE IF NOT EXISTS section_days (
	user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	day         date NOT NULL,
	paper_id    text NOT NULL,
	section_id  text NOT NULL,
	how         text NOT NULL,
	at          timestamp NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, day, paper_id, section_id)
);
CREATE INDEX IF NOT EXISTS section_days_user_day_idx ON section_days (user_id, day);

ALTER TABLE section_days ENABLE ROW LEVEL SECURITY;
