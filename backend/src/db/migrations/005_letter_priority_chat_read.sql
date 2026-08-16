-- Letter priority + chat read watermark.
--   - letters.priority: enum('normal','important','high','special') so the admin
--     can flag a letter's importance and the user sees a clear visual label.
--   - chat_read_state: per-role watermark of the highest message id seen, used
--     to compute genuine unread incoming chat messages (one row per role — the
--     only two roles that exist — never one row per message).
-- Required only for databases created before this feature (schema.sql already
-- includes both for fresh databases). Run once against an existing D1
-- database: `npm run db:migrate:features`
-- Backwards compatible: existing letters default to 'normal'; no read state is
-- assumed (missing rows simply mean "nothing read yet").

ALTER TABLE letters ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal','important','high','special'));

CREATE TABLE IF NOT EXISTS chat_read_state (
  role TEXT PRIMARY KEY CHECK (role IN ('user','admin')),
  last_read_message_id INTEGER NOT NULL DEFAULT 0
);
