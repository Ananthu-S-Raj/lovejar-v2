import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";

const streak = new Hono<AppEnv>();
streak.use("*", requireAuth());

streak.get("/", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT current_streak, longest_streak, last_open_date, garden_stage FROM streak WHERE id = 1"
  ).first<{ current_streak: number; longest_streak: number; last_open_date: string | null; garden_stage: number }>();

  return c.json({
    currentStreak: row?.current_streak ?? 0,
    longestStreak: row?.longest_streak ?? 0,
    lastOpenDate: row?.last_open_date ?? null,
    gardenStage: row?.garden_stage ?? 0, // 0 = seed not yet earned, 1-5 = growth stages after 30/60/90...
    seedUnlocked: (row?.current_streak ?? 0) >= 30,
  });
});

export default streak;
