import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { sendPush } from "../lib/webpush";

// Web Push subscription management. Admin-only: the user's notification model
// is in-app only (no background push by design), so only the admin is allowed
// to register a push subscription. Subscriptions are tied to the authenticated
// admin session via the requireAuth("admin") guard below.
const push = new Hono<AppEnv>();
push.use("*", requireAuth("admin"));

const ENDPOINT_RE = /^https:\/\/[^\s]+\/|^wss:\/\/[^\s]+\//;

push.get("/vapid-public-key", (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) return c.json({ error: "Web Push is not configured" }, 503);
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

push.post("/subscribe", async (c) => {
  const { endpoint, p256dh, auth } = await c.req.json<{ endpoint?: string; p256dh?: string; auth?: string }>();
  if (!endpoint || !p256dh || !auth) return c.json({ error: "endpoint, p256dh and auth are required" }, 400);
  if (!ENDPOINT_RE.test(endpoint)) return c.json({ error: "Invalid push endpoint" }, 400);
  if (!/^[A-Za-z0-9+/_-]{20,}$/.test(p256dh) || !/^[A-Za-z0-9+/_-]{10,}$/.test(auth)) {
    return c.json({ error: "Invalid subscription key material" }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO push_subscriptions (recipient, endpoint, p256dh, auth, created_at, last_seen_at) " +
      "VALUES ('admin', ?, ?, ?, ?, ?) " +
      "ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, last_seen_at = excluded.last_seen_at"
  )
    .bind(endpoint, p256dh, auth, now, now)
    .run();
  return c.json({ ok: true });
});

push.post("/unsubscribe", async (c) => {
  const { endpoint } = await c.req.json<{ endpoint?: string }>();
  if (!endpoint) return c.json({ error: "endpoint is required" }, 400);
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
  return c.json({ ok: true });
});

push.get("/status", async (c) => {
  const configured = !!(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY && c.env.VAPID_SUBJECT);
  const count = await c.env.DB
    .prepare("SELECT COUNT(*) AS c FROM push_subscriptions WHERE recipient = 'admin'")
    .first<{ c: number }>();
  const lastSeen = await c.env.DB
    .prepare("SELECT MAX(last_seen_at) AS t FROM push_subscriptions WHERE recipient = 'admin'")
    .first<{ t: number | null }>();
  return c.json({
    configured,
    subscriptions: count?.c ?? 0,
    lastSeenAt: lastSeen?.t ?? null,
  });
});

// Sends a test push so the admin can verify delivery end to end.
push.post("/test", async (c) => {
  if (!c.env.VAPID_PUBLIC_KEY || !c.env.VAPID_PRIVATE_KEY || !c.env.VAPID_SUBJECT) {
    return c.json({ error: "Web Push is not configured" }, 503);
  }
  const rows = await c.env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE recipient = 'admin'").all<{
    endpoint: string;
    p256dh: string;
    auth: string;
  }>();
  if ((rows.results ?? []).length === 0) {
    return c.json({ error: "No push subscription registered yet" }, 400);
  }
  let ok = 0;
  let gone = 0;
  for (const sub of rows.results ?? []) {
    const status = await sendPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      JSON.stringify({ title: "LoveJar test notification", body: "This is a test — stay close 💕", type: "admin" }),
      c.env
    );
    if (status === "ok") ok++;
    if (status === "gone") {
      gone++;
      await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
    }
  }
  return c.json({ ok, gone });
});

export default push;
