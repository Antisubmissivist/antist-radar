-- News items Kael already wrote a diary about. Filled by syncKael() from
-- kaelblog.com/api/v1/used.json (Worker cron, refreshed at most every 6h).
-- Used two ways: the news card links to the diary, and /api/daily carries the
-- flag so the next diary does not repeat a story Kael already covered.
CREATE TABLE IF NOT EXISTS kael_used (
  source_url   TEXT PRIMARY KEY,
  diary_url    TEXT NOT NULL,
  diary_date   TEXT,
  title        TEXT,
  refreshed_at TEXT
);
