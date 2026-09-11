-- Event archive: keep every event ever published, not just the latest snapshot.
CREATE TABLE IF NOT EXISTS events (
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
  evidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category, first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_events_seen ON events(first_seen DESC);
