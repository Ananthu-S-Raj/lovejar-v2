import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { istDateString, isBirthdayToday } from "../lib/time";
import { generateJarMessage, type Mood } from "../lib/gemini";
import { notify } from "../lib/notifications";

const jar = new Hono<AppEnv>();
jar.use("*", requireAuth("user"));

const VALID_MOODS: Mood[] = ["happy", "sad", "need_energy", "missing_you"];

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

// GET /jar/status — whether today's jar has already been opened, and today's message if so
jar.get("/status", async (c) => {
  const today = istDateString();
  const entry = await c.env.DB.prepare("SELECT mood, message FROM jar_entries WHERE date = ?")
    .bind(today)
    .first<{ mood: string; message: string }>();

  const streak = await c.env.DB.prepare("SELECT current_streak, longest_streak, garden_stage FROM streak WHERE id = 1").first<{
    current_streak: number;
    longest_streak: number;
    garden_stage: number;
  }>();

  const available = (await getSetting(c.env.DB, "jar_available_override")) !== "false";

  return c.json({
    date: today,
    isBirthday: isBirthdayToday(),
    available,
    opened: !!entry,
    mood: entry?.mood ?? null,
    message: entry?.message ?? null,
    streak: streak ?? { current_streak: 0, longest_streak: 0, garden_stage: 0 },
  });
});

// POST /jar/open { mood }
jar.post("/open", async (c) => {
  const { mood } = await c.req.json<{ mood?: string }>();
  if (!mood || !VALID_MOODS.includes(mood as Mood)) {
    return c.json({ error: "Invalid mood" }, 400);
  }

  // Admin can pause the jar (e.g. on a break) without touching the streak or
  // today's already-opened entry. This makes the admin override functional.
  const available = (await getSetting(c.env.DB, "jar_available_override")) !== "false";
  if (!available) {
    return c.json({ error: "The jar is resting right now — try again later.", reason: "The jar is temporarily unavailable." }, 423);
  }

  const today = istDateString();
  const existing = await c.env.DB.prepare("SELECT mood, message FROM jar_entries WHERE date = ?")
    .bind(today)
    .first<{ mood: string; message: string }>();
  if (existing) {
    return c.json({ opened: true, mood: existing.mood, message: existing.message, alreadyOpenedToday: true });
  }

  // Last 30 days of messages, to avoid repeats
  const cutoffTs = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const recentRows = await c.env.DB.prepare(
    "SELECT message FROM ai_message_history WHERE created_at >= ? ORDER BY created_at DESC LIMIT 60"
  )
    .bind(cutoffTs)
    .all<{ message: string }>();
  const recentMessages = (recentRows.results ?? []).map((r) => r.message);

  const { message, source } = await generateJarMessage(mood as Mood, c.env.USER_NAME, c.env.GEMINI_API_KEY, recentMessages);
  const now = Math.floor(Date.now() / 1000);

  // Update streak
  const streakRow = await c.env.DB.prepare(
    "SELECT current_streak, longest_streak, last_open_date, garden_stage FROM streak WHERE id = 1"
  ).first<{ current_streak: number; longest_streak: number; last_open_date: string | null; garden_stage: number }>();

  let current = 1;
  if (streakRow?.last_open_date) {
    const yesterday = istDateString(new Date(Date.now() - 24 * 60 * 60 * 1000 + 5.5 * 60 * 60 * 1000));
    current = streakRow.last_open_date === yesterday ? streakRow.current_streak + 1 : 1;
  }
  const longest = Math.max(current, streakRow?.longest_streak ?? 0);
  const gardenStage = current >= 30 ? Math.min(5, Math.floor(current / 30)) : 0;

  // All three writes happen in a single D1 batch (one transaction): the jar
  // entry, the AI message history row, and the streak update either all commit
  // or none do. INSERT OR IGNORE keeps the "once per day" guarantee safe even
  // if two opens race; changes === 0 means today was already recorded.
  const batch = await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO jar_entries (date, mood, message, created_at) VALUES (?, ?, ?, ?)").bind(
      today,
      mood,
      message,
      now
    ),
    c.env.DB.prepare("INSERT INTO ai_message_history (mood, message, source, created_at) VALUES (?, ?, ?, ?)").bind(
      mood,
      message,
      source,
      now
    ),
    c.env.DB.prepare(
      "UPDATE streak SET current_streak = ?, longest_streak = ?, last_open_date = ?, garden_stage = ?, updated_at = unixepoch() WHERE id = 1"
    ).bind(current, longest, today, gardenStage),
  ]);

  const inserted = batch?.[0]?.meta?.changes ?? 0;
  const streakPayload = { current_streak: current, longest_streak: longest, garden_stage: gardenStage };

  if (inserted === 0) {
    // A concurrent request already opened the jar today; return its message.
    const raced = await c.env.DB
      .prepare("SELECT mood, message FROM jar_entries WHERE date = ?")
      .bind(today)
      .first<{ mood: string; message: string }>();
    return c.json({
      opened: true,
      mood: raced?.mood ?? mood,
      message: raced?.message ?? message,
      alreadyOpenedToday: true,
      isBirthday: isBirthdayToday(),
      streak: streakPayload,
    });
  }

  // Genuine jar event: a real open happened. Notify the admin (two-person app —
  // the partner cares), and raise a streak-milestone notification to the user
  // only when a true milestone is crossed (never on page loads).
  const milestone = current >= 7 && current % 7 === 0;
  await notify(c.env, "admin", "jar", `${c.env.USER_NAME} opened today's jar`, mood, undefined);
  if (milestone) {
    await notify(c.env, "user", "streak", `${current}-day streak!`, "You're on fire — keep it going 💕", undefined);
  }

  return c.json({
    opened: true,
    mood,
    message,
    alreadyOpenedToday: false,
    isBirthday: isBirthdayToday(),
    streak: streakPayload,
  });
});

export default jar;
