// Lightweight admin action audit trail. Every meaningful admin action calls
// logAdminAction so the admin can later answer "what changed, and when?".
// Deliberately small — an action tag, a human-readable detail line and a
// timestamp. Not a replacement for real observability, and intentionally
// never allowed to break the action that triggered it.

export async function logAdminAction(db: D1Database, action: string, detail: string): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO admin_actions (action, detail, created_at) VALUES (?, ?, unixepoch())")
      .bind(action, detail)
      .run();
  } catch {
    // Logging is best-effort; never fail the underlying action.
  }
}
