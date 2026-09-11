-- R1: owner binding + webhook secret + update dedupe + one-time pair code.
ALTER TABLE subscribers ADD COLUMN owner_user_id TEXT;
ALTER TABLE subscribers ADD COLUMN webhook_secret TEXT;
ALTER TABLE subscribers ADD COLUMN last_update_id INTEGER;
ALTER TABLE subscribers ADD COLUMN pair_code TEXT;
