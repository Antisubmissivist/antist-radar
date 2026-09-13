-- Story threads: several reports of one developing story share a thread_id.
--
-- Assignment is append-only. thread_id is written when a row is first inserted
-- and is never touched by the ON CONFLICT update, so a reader's timeline cannot
-- rearrange itself between visits.
--
-- thread_terms caches the identity terms of the headline so matching a new
-- event against two weeks of history reads one short column instead of parsing
-- every stored title.
ALTER TABLE events ADD COLUMN thread_id TEXT;
ALTER TABLE events ADD COLUMN thread_terms TEXT;
CREATE INDEX IF NOT EXISTS idx_events_thread ON events(thread_id, first_seen);
