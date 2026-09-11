-- Self-serve Telegram subscribers: users bring their own bot token.
CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  secret TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  bot_username TEXT,
  chat_id TEXT,
  lang TEXT NOT NULL DEFAULT 'zh',
  hour INTEGER NOT NULL DEFAULT 8,
  boards TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  last_sent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribers_due ON subscribers(active, hour);
