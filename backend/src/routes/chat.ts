import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { logAdminAction } from "../lib/admin-log";
import { LIMITS } from "../lib/limits";
import { wsOriginGuard } from "../lib/security";

const chat = new Hono<AppEnv>();
// Origin-gate the WebSocket upgrade BEFORE session auth (registration order),
// so a cross-site page can never even probe session validity and disallowed
// origins are rejected without a D1 lookup. Scoped to /ws only: every other
// /chat/* route and all internal Worker -> ChatRoom DO calls are unaffected.
chat.use("/ws", wsOriginGuard);
chat.use("*", requireAuth());

function chatStub(env: AppEnv["Bindings"]) {
  const id = env.CHAT_ROOM.idFromName("lovejar-chat");
  return env.CHAT_ROOM.get(id);
}

chat.get("/history", async (c) => {
  const role = c.get("role");
  const col = role === "user" ? "deleted_for_user" : "deleted_for_admin";
  const rows = await c.env.DB.prepare(
    `SELECT id, sender, body, kind, created_at FROM chat_messages
     WHERE deleted_for_everyone = 0 AND ${col} = 0
     ORDER BY created_at ASC LIMIT 200`
  ).all();
  return c.json({ messages: rows.results ?? [] });
});

// Nicknames for chat display. The write endpoint stays admin-only
// (POST /admin/nicknames); this read is available to any authenticated role
// so both partners can show each other's configured names. Defaults come from
// the server env (USER_NAME / "Admin") so clients never need to guess a name.
chat.get("/names", async (c) => {
  const rows = await c.env.DB.prepare("SELECT role, nickname FROM nicknames").all<{ role: string; nickname: string }>();
  const names: Record<string, string> = { user: c.env.USER_NAME, admin: "Admin" };
  for (const r of rows.results ?? []) names[r.role] = r.nickname;
  return c.json({ names });
});

// User-side nickname for the Admin, editable by the USER from the chat page.
// Stored in D1 (persistent, not localStorage). Both partners write the same
// single source of truth (nicknames.role = 'admin'), so the last writer wins
// and every display — chat header, status, sender names, popups and
// notifications — resolves through /chat/names / the DB consistently.
// The Admin keeps their own setting surface (Admin → User → Nicknames).
chat.post("/nickname/admin", async (c) => {
  const { nickname } = await c.req.json<{ nickname?: string }>();
  if (!nickname || !nickname.trim()) return c.json({ error: "Nickname required" }, 400);
  const clean = nickname.trim();
  if (clean.length > LIMITS.NICKNAME) {
    return c.json({ error: `Nickname must be ${LIMITS.NICKNAME} characters or fewer` }, 400);
  }
  await c.env.DB
    .prepare(
      "INSERT INTO nicknames (role, nickname) VALUES ('admin', ?) ON CONFLICT(role) DO UPDATE SET nickname = excluded.nickname"
    )
    .bind(clean)
    .run();
  await logAdminAction(c.env.DB, "nickname_set", `Set nickname for admin to "${clean}" (from chat)`);
  return c.json({ ok: true });
});

// Reset the Admin's nickname back to the default ("Admin").
chat.delete("/nickname/admin", async (c) => {
  await c.env.DB.prepare("DELETE FROM nicknames WHERE role = 'admin'").run();
  await logAdminAction(c.env.DB, "nickname_reset", "Reset the admin nickname to default (from chat)");
  return c.json({ ok: true });
});

function readStateHelpers(role: "user" | "admin") {
  const selfCol = role === "user" ? "deleted_for_user" : "deleted_for_admin";
  const peer: "user" | "admin" = role === "user" ? "admin" : "user";
  return { selfCol, peer };
}

// Genuine unread count for the caller: messages written by the peer, still
// visible to the caller, newer than the caller's read watermark. The caller's
// own messages never count, deleted messages never count, and nothing is
// marked unread merely because history loaded or the socket connected.
chat.get("/unread", async (c) => {
  const role = c.get("role");
  const { selfCol, peer } = readStateHelpers(role);
  const state = await c.env.DB
    .prepare("SELECT last_read_message_id FROM chat_read_state WHERE role = ?")
    .bind(role)
    .first<{ last_read_message_id: number }>();
  const lastRead = state?.last_read_message_id ?? 0;
  const row = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS c FROM chat_messages
       WHERE deleted_for_everyone = 0 AND ${selfCol} = 0 AND sender = ? AND id > ?`
    )
    .bind(peer, lastRead)
    .first<{ c: number }>();
  return c.json({ unread: row?.c ?? 0 });
});

// Advance the caller's read watermark to the newest message still visible to
// them. Server-computed (never trusts a client-supplied id). Idempotent.
chat.post("/read", async (c) => {
  const role = c.get("role");
  const { selfCol } = readStateHelpers(role);
  await c.env.DB
    .prepare(
      `INSERT INTO chat_read_state (role, last_read_message_id)
       VALUES (?, (SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE deleted_for_everyone = 0 AND ${selfCol} = 0))
       ON CONFLICT(role) DO UPDATE SET last_read_message_id = excluded.last_read_message_id`
    )
    .bind(role)
    .run();
  return c.json({ ok: true });
});

// WebSocket upgrade: GET /chat/ws  -> proxied into the singleton ChatRoom Durable Object
chat.get("/ws", async (c) => {
  const role = c.get("role");
  const stub = chatStub(c.env);
  const url = new URL(c.req.url);
  url.pathname = "/ws";
  url.searchParams.set("role", role);
  return stub.fetch(url.toString(), c.req.raw);
});

// Live presence of both partners. Reached by any authenticated role (the
// frontend chat shows who's online); the DO endpoint itself is stateless.
chat.get("/status", async (c) => {
  const res = await chatStub(c.env).fetch("https://internal/status");
  return c.json(await res.json<{ online: { user: boolean; admin: boolean } }>());
});

// Application-level presence heartbeat. Reached by any authenticated role from
// the app shell on any page, so "online" means "the app is open" rather than
// "the chat page is open". The DO expires a role after a short grace period of
// missed heartbeats. Doubles as a cheap session-liveness check: a revoked
// session 401s here, which logs the client out immediately.
chat.post("/presence", async (c) => {
  const role = c.get("role");
  await chatStub(c.env).fetch("https://internal/app-presence", {
    method: "POST",
    body: JSON.stringify({ role }),
  });
  return c.json({ ok: true });
});

// Admin-only chat controls (role enforced here; the DO proxies are internal).
chat.post("/affection", requireAuth("admin"), async (c) => {
  const { kind } = await c.req.json<{ kind?: string }>();
  if (kind !== "hug" && kind !== "kiss") return c.json({ error: "kind must be hug or kiss" }, 400);
  const res = await chatStub(c.env).fetch("https://internal/affection", {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
  if (!res.ok) return c.json({ error: "Failed to send" }, 502);
  await logAdminAction(c.env.DB, "affection_sent", `Sent a ${kind} to ${c.env.USER_NAME}`);
  return c.json({ ok: true });
});

chat.post("/messages/:id/delete", requireAuth("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid message id" }, 400);
  // Sender-only rule (mirrors the WS path): even the admin may only delete
  // their own messages for everyone. The DO enforces it too; this check just
  // surfaces a clear error and avoids logging a "deleted" action that no-op'd.
  const row = await c.env.DB
    .prepare("SELECT sender FROM chat_messages WHERE id = ?")
    .bind(id)
    .first<{ sender: "user" | "admin" }>();
  if (!row) return c.json({ error: "Message not found" }, 404);
  if (row.sender !== "admin") return c.json({ error: "Only the sender can delete a message for everyone" }, 403);
  const res = await chatStub(c.env).fetch("https://internal/delete", {
    method: "POST",
    body: JSON.stringify({ id, forEveryone: true }),
  });
  if (!res.ok) return c.json({ error: "Failed to delete message" }, 502);
  await logAdminAction(c.env.DB, "chat_message_deleted", `Deleted message #${id} for everyone`);
  return c.json({ ok: true });
});

chat.post("/clear", requireAuth("admin"), async (c) => {
  const res = await chatStub(c.env).fetch("https://internal/clear-everyone", { method: "POST" });
  if (!res.ok) return c.json({ error: "Failed to clear chat" }, 502);
  await logAdminAction(c.env.DB, "chat_cleared", "Cleared the entire chat history for everyone");
  return c.json({ ok: true });
});

export default chat;
