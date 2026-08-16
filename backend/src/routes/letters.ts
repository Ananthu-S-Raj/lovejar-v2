import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { LIMITS } from "../lib/limits";
import { notify } from "../lib/notifications";

const letters = new Hono<AppEnv>();
letters.use("*", requireAuth());

const LETTER_PRIORITIES = ["normal", "important", "high", "special"] as const;
export type LetterPriority = (typeof LETTER_PRIORITIES)[number];

function isPriority(v: unknown): v is LetterPriority {
  return typeof v === "string" && (LETTER_PRIORITIES as readonly string[]).includes(v);
}

// Notification copy for each priority (used only when it genuinely improves the
// message; normal letters keep the original wording).
const PRIORITY_NOTICE: Record<LetterPriority, { prefix: string }> = {
  normal: { prefix: "A new letter arrived" },
  important: { prefix: "💌 An important letter arrived" },
  high: { prefix: "❤️ A high-priority letter arrived" },
  special: { prefix: "✨ A special letter arrived" },
};

function noticeTitle(priority: LetterPriority): string {
  return PRIORITY_NOTICE[priority].prefix;
}

// User sees only sent letters. Admin sees all (drafts + sent) and can create/send.
letters.get("/", async (c) => {
  const role = c.get("role");
  const query =
    role === "admin"
      ? "SELECT id, title, body, priority, read_at, sent_at, is_draft, created_at FROM letters ORDER BY created_at DESC"
      : "SELECT id, title, body, priority, read_at, sent_at, created_at FROM letters WHERE is_draft = 0 ORDER BY sent_at DESC";
  const rows = await c.env.DB.prepare(query).all();
  return c.json({ letters: rows.results ?? [] });
});

letters.post("/", async (c) => {
  if (c.get("role") !== "admin") return c.json({ error: "Forbidden" }, 403);
  const { title, body, sendNow, priority } = await c.req.json<{
    title?: string;
    body?: string;
    sendNow?: boolean;
    priority?: string;
  }>();
  if (!title || !body) return c.json({ error: "Title and body required" }, 400);
  if (title.length > LIMITS.LETTER_TITLE) {
    return c.json({ error: `Title must be ${LIMITS.LETTER_TITLE} characters or fewer` }, 400);
  }
  if (body.length > LIMITS.LETTER_BODY) {
    return c.json({ error: `Body must be ${LIMITS.LETTER_BODY} characters or fewer` }, 400);
  }
  // Server-side validation of the priority enum — never trust the frontend.
  // An invalid value is rejected (not silently coerced) so a buggy client
  // can't store data the UI can't render.
  if (priority !== undefined && !isPriority(priority)) {
    return c.json({ error: "Invalid priority" }, 400);
  }
  const level: LetterPriority = priority ?? "normal";
  const now = Math.floor(Date.now() / 1000);
  const result = await c.env.DB.prepare(
    "INSERT INTO letters (title, body, priority, sent_at, is_draft, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(title, body, level, sendNow ? now : null, sendNow ? 0 : 1, now)
    .run();
  if (sendNow) {
    await notify(c.env, "user", "letter", noticeTitle(level), title, Number(result.meta.last_row_id));
  }
  return c.json({ id: result.meta.last_row_id, priority: level, ok: true });
});

letters.post("/:id/send", async (c) => {
  if (c.get("role") !== "admin") return c.json({ error: "Forbidden" }, 403);
  const id = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare("UPDATE letters SET is_draft = 0, sent_at = ? WHERE id = ?").bind(now, id).run();
  const row = await c.env.DB
    .prepare("SELECT title, priority FROM letters WHERE id = ?")
    .bind(id)
    .first<{ title: string; priority: string }>();
  if (row) {
    const level: LetterPriority = isPriority(row.priority) ? row.priority : "normal";
    await notify(c.env, "user", "letter", noticeTitle(level), row.title, Number(id));
  }
  return c.json({ ok: true });
});

letters.delete("/:id", async (c) => {
  if (c.get("role") !== "admin") return c.json({ error: "Forbidden" }, 403);
  await c.env.DB.prepare("DELETE FROM letters WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// Mark a letter read (user-only — the user is the one reading). Idempotent:
// the first read time is kept (COALESCE), so opening the same letter again
// updates nothing and can never create duplicates or extra notifications.
letters.patch("/:id/read", async (c) => {
  if (c.get("role") !== "user") return c.json({ error: "Forbidden" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid letter" }, 400);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare("UPDATE letters SET read_at = COALESCE(read_at, ?) WHERE id = ? AND is_draft = 0")
    .bind(now, id)
    .run();
  return c.json({ ok: true });
});

export default letters;
