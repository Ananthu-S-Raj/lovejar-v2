// Central notification service. Every genuine application event funnels
// through `notify()`, which:
//   - persists an in-app notification for the recipient, and
//   - delivers a Web Push to the admin when the recipient is the admin.
// The user never receives background push (by design); push is admin-only.
//
// Events are wired here so notification creation stays in one place instead of
// being scattered through the routes / Durable Object.

import { sendPush } from "./webpush";

export type NotificationType =
  | "chat"
  | "hug"
  | "kiss"
  | "jar"
  | "streak"
  | "letter"
  | "bucket"
  | "calendar"
  | "pet"
  | "game"
  | "security";

export type NotificationRow = {
  id: number;
  recipient: "user" | "admin";
  type: NotificationType;
  title: string;
  body: string;
  reference_id: number | null;
  read_at: number | null;
  created_at: number;
};

type Bindings = {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

// Retention: keep at most KEEP_LIMIT per recipient and nothing older than
// KEEP_DAYS. Enforced lazily on read so no scheduled job is required.
const KEEP_LIMIT = 100;
const KEEP_DAYS = 30;

export async function createNotification(
  db: D1Database,
  recipient: "user" | "admin",
  type: NotificationType,
  title: string,
  body: string,
  referenceId?: number | null
): Promise<NotificationRow> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      "INSERT INTO notifications (recipient, type, title, body, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(recipient, type, title, body, referenceId ?? null, now)
    .run();
  return {
    id: Number(result.meta.last_row_id),
    recipient,
    type,
    title,
    body,
    reference_id: referenceId ?? null,
    read_at: null,
    created_at: now,
  };
}

// Deliver a push to every valid admin subscription; prune ones the push
// service reports as gone. Best-effort — never throws.
export async function pushToAdmin(env: Bindings, payload: { title: string; body: string; type: string }): Promise<void> {
  try {
    const rows = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE recipient = 'admin'").all<{
      endpoint: string;
      p256dh: string;
      auth: string;
    }>();
    for (const sub of rows.results ?? []) {
      const status = await sendPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        JSON.stringify({ title: payload.title, body: payload.body, type: payload.type }),
        env
      );
      if (status === "gone") {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
      }
    }
  } catch {
    // non-fatal
  }
}

// The single entry point used by feature code.
export async function notify(
  env: Bindings,
  recipient: "user" | "admin",
  type: NotificationType,
  title: string,
  body: string,
  referenceId?: number | null
): Promise<void> {
  const n = await createNotification(env.DB, recipient, type, title, body, referenceId);
  if (recipient === "admin") {
    // Fire-and-forget; the in-app row is already persisted and the push is
    // best-effort so a slow push service must not delay the caller.
    void pushToAdmin(env, { title: n.title, body: n.body, type: n.type });
  }
}

export async function pruneNotifications(db: D1Database): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - KEEP_DAYS * 24 * 60 * 60;
  await db.prepare("DELETE FROM notifications WHERE created_at < ?").bind(cutoff).run();
  // Cap newest rows per recipient so one recipient can never crowd out the other.
  for (const recipient of ["user", "admin"] as const) {
    const kept = await db
      .prepare("SELECT id FROM notifications WHERE recipient = ? ORDER BY id DESC LIMIT ?")
      .bind(recipient, KEEP_LIMIT)
      .all<{ id: number }>();
    const ids = (kept.results ?? []).map((r) => r.id);
    if (ids.length < KEEP_LIMIT) continue;
    await db.prepare("DELETE FROM notifications WHERE recipient = ? AND id < ?").bind(recipient, ids[ids.length - 1]).run();
  }
}
