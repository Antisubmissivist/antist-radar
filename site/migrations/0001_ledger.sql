CREATE TABLE IF NOT EXISTS forecasts (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL, due_at TEXT NOT NULL,
 symbol TEXT NOT NULL, baseline REAL NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('above','below')),
 probability REAL NOT NULL CHECK(probability>0 AND probability<1),
 claim_json TEXT NOT NULL, rationale_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','hit','miss','unresolved')),
 resolved_at TEXT, observed REAL, observation_at TEXT
);
CREATE INDEX IF NOT EXISTS forecasts_due ON forecasts(status,due_at);
CREATE TABLE IF NOT EXISTS sweeps (
 id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, published_at TEXT NOT NULL,
 source_count INTEGER NOT NULL, healthy_count INTEGER NOT NULL, event_count INTEGER NOT NULL,
 archive_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
 id TEXT PRIMARY KEY, state TEXT NOT NULL, created_at TEXT NOT NULL, message_ids TEXT
);
