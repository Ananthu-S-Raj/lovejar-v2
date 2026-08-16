-- Admin Control Center support.
--   - optional reason on PIN reset requests (displayed in the admin panel)
--   - AI source tracking for jar messages (gemini | fallback) so the admin can
--     verify whether the jar used live AI or the fallback bank
--   - lightweight admin action audit log (login, PIN approve/deny, streak
--     adjustment, chat moderation, notification sends, etc.)
-- Required only for databases created before this feature (schema.sql already
-- includes these for fresh databases). Run once against an existing D1
-- database: `npm run db:migrate:admin`
-- Backwards compatible: existing rows default to 'fallback' for source and get
-- a NULL reason.

ALTER TABLE password_reset_requests ADD COLUMN reason TEXT;

ALTER TABLE ai_message_history ADD COLUMN source TEXT NOT NULL DEFAULT 'fallback';

CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions (created_at);
