// Reasonable upper bounds for user-controlled text fields.
// The backend is the authoritative validation layer; the frontend mirrors
// these as `maxLength` attributes but must never be the only check.

export const LIMITS = {
  CHAT_MESSAGE: 2000,
  LETTER_TITLE: 120,
  LETTER_BODY: 20000,
  BUCKET_TITLE: 120,
  BUCKET_DESCRIPTION: 500,
  CALENDAR_TITLE: 120,
  CALENDAR_DESCRIPTION: 500,
  NICKNAME: 50,
  DISABLE_REASON: 200,
  ADMIN_PASSWORD_MAX: 200,
  STREAK_MAX: 3650,
  RESET_REASON: 200,
  NOTIFICATION_TITLE: 120,
  NOTIFICATION_BODY: 500,
  AUTH_FAIL_WINDOW_SECONDS: 15 * 60,
  AUTH_MAX_FAILURES: 5,
} as const;
