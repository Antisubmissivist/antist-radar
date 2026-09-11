-- Public-bot state: global update dedupe (no per-user bot tokens stored).
CREATE TABLE IF NOT EXISTS tg_state (k TEXT PRIMARY KEY, v TEXT);
