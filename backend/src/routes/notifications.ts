import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { pruneNotifications } from "../lib/notifications";

const notifications = new Hono<AppEnv>();
notifications.use("*", requireAuth());

const LIST_LIMIT = 50;

notifications.get("/", async (c) => {
  const role = c.get("role");
  // Best-effort retention cleanup (old rows + cap per recipient).
  await pruneNotifications(c.env.DB).catch(() => {});
  const rows = await c.env.DB.prepare(
    "SELECT id, recipient, type, title, body, reference_id, read_at, created_at " +
      "FROM notifications WHERE recipient = ? ORDER BY id DESC LIMIT ?"
  )
    .bind(role, LIST_LIMIT)
    .all<{
      id: number;
      type: string;
      title: string;
      body: string;
      reference_id: number | null;
      read_at: number | null;
      created_at: number;
    }>();
  const unread = await c.env.DB.prepare(
    "SELECT COUNT(*) AS c FROM notifications WHERE recipient = ? AND read_at IS NULL"
  )
    .bind(role)
    .first<{ c: number }>();
  return c.json({ notifications: rows.results ?? [], unreadCount: unread?.c ?? 0 });
});

notifications.post("/:id/read", async (c) => {
  const role = c.get("role");
  const id = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND recipient = ?")
    .bind(now, id, role)
    .run();
  return c.json({ ok: true });
});

notifications.post("/read-all", async (c) => {
  const role = c.get("role");
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE recipient = ?")
    .bind(now, role)
    .run();
  return c.json({ ok: true });
});

export default notifications;
