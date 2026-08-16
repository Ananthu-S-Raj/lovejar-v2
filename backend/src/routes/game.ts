import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { notify } from "../lib/notifications";

const game = new Hono<AppEnv>();
game.use("*", requireAuth("user"));

const MAX_SCORE = 25;

function messageForScore(score: number): string {
  const pct = score / MAX_SCORE;
  if (pct >= 0.9) return "Perfect catch streak! My heart doesn't stand a chance against you ❤️";
  if (pct >= 0.7) return "So close to flawless — you're catching hearts as fast as I fall for you.";
  if (pct >= 0.5) return "Good round! Every heart you caught, I'd already given away.";
  if (pct >= 0.25) return "A few hearts got away, but mine never will.";
  return "Rusty round, but hey — you already caught the one that matters most: me.";
}

game.post("/score", async (c) => {
  const { score } = await c.req.json<{ score?: number }>();
  if (typeof score !== "number" || score < 0 || score > MAX_SCORE) {
    return c.json({ error: `Score must be between 0 and ${MAX_SCORE}` }, 400);
  }
  const message = messageForScore(score);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare("INSERT INTO game_scores (score, message, created_at) VALUES (?, ?, ?)")
    .bind(score, message, now)
    .run();
  await notify(c.env, "admin", "game", "New game result", `${c.env.USER_NAME} scored ${score}/${MAX_SCORE} in Catch the Hearts 🎮`);
  return c.json({ score, message, maxScore: MAX_SCORE });
});

game.get("/best", async (c) => {
  const row = await c.env.DB.prepare("SELECT score, message, created_at FROM game_scores ORDER BY score DESC LIMIT 1").first();
  return c.json({ best: row ?? null, maxScore: MAX_SCORE });
});

export default game;
