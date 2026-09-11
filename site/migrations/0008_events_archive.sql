-- Backup for events older than the 10-day site retention window.
-- The live `events` table stays small (fast archive pages + fast AI scoring);
-- pruned rows are copied here first, so nothing is lost.
CREATE TABLE IF NOT EXISTS events_archive (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  stage TEXT,
  deadline_at TEXT,
  change TEXT,
  title_json TEXT NOT NULL,
  summary_json TEXT,
  audience_json TEXT,
  action_json TEXT,
  unknowns_json TEXT,
  evidence TEXT,
  score INTEGER,
  archived_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_archive_seen ON events_archive(first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_events_archive_category ON events_archive(category, first_seen DESC);
