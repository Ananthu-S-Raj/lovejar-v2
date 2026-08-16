-- Letter read state: NULL = unread, unix seconds = when the user first read it.
ALTER TABLE letters ADD COLUMN read_at INTEGER;

-- Login attempts: categorize failures (wrong PIN vs rate-limit block) so the
-- admin can read the user's login history without any credential material.
ALTER TABLE login_attempts ADD COLUMN reason TEXT;

-- Rate-limit window scans and history listing both filter by role/created_at.
CREATE INDEX IF NOT EXISTS idx_login_attempts_role_created ON login_attempts (role, created_at);
