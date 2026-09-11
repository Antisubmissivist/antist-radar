-- Group/topic subscriptions: when the bot is @mentioned inside a forum topic,
-- post the daily digest to that exact topic (chat_id + message_thread_id).
ALTER TABLE subscribers ADD COLUMN thread_id TEXT;
ALTER TABLE subscribers ADD COLUMN chat_title TEXT;
