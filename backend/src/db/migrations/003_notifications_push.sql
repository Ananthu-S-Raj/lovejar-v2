-- Universal notifications + admin Web Push subscriptions.
-- Required only for databases created before this feature (schema.sql already
-- includes both tables for fresh databases). Run once against an existing D1
-- database: `npm run db:migrate:upgrade`
-- (update the migration runner in package.json to point at this file).

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL CHECK (recipient IN ('user','admin')),
  type TEXT NOT NULL,               -- chat | hug | kiss | jar | streak | letter | bucket | calendar | pet | game | security
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reference_id INTEGER,             -- optional id of the related entity (e.g. chat message id)
  read_at INTEGER,                  -- NULL = unread
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient, id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL CHECK (recipient IN ('admin')),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
