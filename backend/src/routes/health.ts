import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { chatRoomStatus } from "./admin";

// Production observability endpoints for uptime monitors (UptimeRobot, Better
// Uptime, Cronitor, ...). Deliberately cheap: no AI, no weather, no large table
// scans — a monitor may hit /health every 1–5 minutes.
//
//   GET /health           public, no dependencies, always 200 when the worker is alive
//   GET /health/ready     public, checks D1; 200 ready / 503 not ready
//   GET /health/details   admin-only, detailed component status (no secrets)
//
// All responses use the same shape: { status, timestamp?, checks? }.

const health = new Hono<AppEnv>();

health.get("/health", (c) => c.json({ status: "ok" }));

health.get("/health/ready", async (c) => {
  const timestamp = new Date().toISOString();
  let database: "ok" | "error" = "ok";
  try {
    await c.env.DB.prepare("SELECT 1 AS ok").first();
  } catch {
    database = "error";
  }
  const ready = database === "ok";
  // 503 (not 500) signals "dependency unavailable" to a monitor; the worker
  // itself is fine and answering this request.
  return c.json({ status: ready ? "ok" : "degraded", timestamp, checks: { database } }, ready ? 200 : 503);
});

health.get("/health/details", requireAuth("admin"), async (c) => {
  const env = c.env;
  const timestamp = new Date().toISOString();

  let database: "ok" | "error" = "ok";
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
  } catch {
    database = "error";
  }

  const realtime: "ok" | "warn" = (await chatRoomStatus(env)).reachable ? "ok" : "warn";
  const pushConfigured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  const notifications: "ok" | "error" = database === "ok" ? "ok" : "error";

  const checks: Record<string, string> = {
    backend: "ok",
    database,
    realtime,
    notifications,
    push: pushConfigured ? "ok" : "warn",
    ai: env.GEMINI_API_KEY ? "ok" : "warn",
    weather: env.WEATHER_API_KEY ? "ok" : "warn",
  };

  const values = Object.values(checks);
  const status = values.includes("error") ? "error" : values.includes("warn") ? "degraded" : "ok";
  return c.json({ status, timestamp, checks });
});

export default health;
