-- KV is reserved for the small "site changed" marker. Config lives in D1.
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
