-- LoveJar D1 schema

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('user','admin')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  success INTEGER NOT NULL,
  reason TEXT, -- NULL = success | 'failed_pin' | 'locked' (rate-limit block)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_role_created ON login_attempts (role, created_at);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  new_pin_hash TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- keys used: user_login_disabled, user_login_disabled_reason, jar_available_override,
-- mute_all, sound_enabled, vibration_enabled

CREATE TABLE IF NOT EXISTS jar_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE, -- YYYY-MM-DD in IST
  mood TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS streak (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_open_date TEXT,
  garden_stage INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO streak (id, current_streak, longest_streak, last_open_date, garden_stage, updated_at)
VALUES (1, 0, 0, NULL, 0, strftime('%s','now'));

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL CHECK (sender IN ('user','admin')),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text', -- 'text' | 'hug' | 'kiss'
  created_at INTEGER NOT NULL,
  deleted_for_everyone INTEGER NOT NULL DEFAULT 0,
  deleted_for_user INTEGER NOT NULL DEFAULT 0,
  deleted_for_admin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nicknames (
  role TEXT PRIMARY KEY, -- whose nickname this is (the person being called this)
  nickname TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER,
  is_draft INTEGER NOT NULL DEFAULT 1,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','high','special')),
  read_at INTEGER, -- NULL = unread; unix seconds of the user's first read
  created_at INTEGER NOT NULL
);

-- Chat read watermark: one row per role (only two roles ever exist), storing
-- the highest chat_messages.id each role has seen. Unread count = peer's
-- messages with id > this watermark. Never one row per message.
CREATE TABLE IF NOT EXISTS chat_read_state (
  role TEXT PRIMARY KEY CHECK (role IN ('user','admin')),
  last_read_message_id INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bucket_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL, -- YYYY-MM-DD
  event_time TEXT,          -- HH:MM, optional
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pet_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Pip',
  hunger INTEGER NOT NULL DEFAULT 70,   -- 0-100
  happiness INTEGER NOT NULL DEFAULT 70,-- 0-100
  energy INTEGER NOT NULL DEFAULT 70,   -- 0-100
  stage TEXT NOT NULL DEFAULT 'baby',   -- baby | teen | adult
  last_fed_at INTEGER,
  last_played_at INTEGER,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO pet_state (id, updated_at) VALUES (1, strftime('%s','now'));

CREATE TABLE IF NOT EXISTS game_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  score INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_message_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mood TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'fallback', -- 'gemini' | 'fallback'
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_history_created ON ai_message_history (created_at);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events (event_date);

-- Lightweight admin action audit log (login, PIN approve/deny, streak
-- adjustment, chat moderation, notification sends, nickname changes, ...).
CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions (created_at);

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
