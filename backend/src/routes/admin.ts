import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { hashSecret, getSetting, setSetting, revokeRoleSessions, revokeAdminSessionsExcept } from "../lib/auth-utils";
import { LIMITS } from "../lib/limits";
import { logAdminAction } from "../lib/admin-log";
import { istDateString, daysBetween } from "../lib/time";
import { recentFailures } from "./auth";

const admin = new Hono<AppEnv>();
admin.use("*", requireAuth("admin"));

// Compact, admin-only summary of the user's login security posture, computed
// from the same login_attempts history the rate limiter uses (no duplicate
// system). lastSuccess = most recent successful user login ever; failed24h =
// failures in the last 24h; failedInWindow = current burst counter (what the
// rate limiter actually enforces); blocked = whether the user is currently
// locked out; locked = how many blocked attempts were recorded.
async function userLoginSecurity(db: D1Database): Promise<{
  lastSuccess: number | null;
  failed24h: number;
  failedInWindow: number;
  blocked: boolean;
  locked: number;
  maxFailures: number;
  windowSeconds: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const lastSuccess = await db
    .prepare("SELECT MAX(created_at) AS t FROM login_attempts WHERE role = 'user' AND success = 1")
    .first<{ t: number | null }>();
  const failed24h = await db
    .prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE role = 'user' AND success = 0 AND created_at >= ?")
    .bind(now - 86400)
    .first<{ c: number }>();
  const locked = await db
    .prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE role = 'user' AND success = 0 AND reason = 'locked' AND created_at >= ?")
    .bind(now - LIMITS.AUTH_FAIL_WINDOW_SECONDS)
    .first<{ c: number }>();
  const failedInWindow = await recentFailures(db, "user", now);
  return {
    lastSuccess: lastSuccess?.t ?? null,
    failed24h: failed24h?.c ?? 0,
    failedInWindow,
    blocked: failedInWindow >= LIMITS.AUTH_MAX_FAILURES,
    locked: locked?.c ?? 0,
    maxFailures: LIMITS.AUTH_MAX_FAILURES,
    windowSeconds: LIMITS.AUTH_FAIL_WINDOW_SECONDS,
  };
}

export async function chatRoomStatus(env: AppEnv["Bindings"]): Promise<{
  online: { user: boolean; admin: boolean };
  reachable: boolean;
}> {
  try {
    const id = env.CHAT_ROOM.idFromName("lovejar-chat");
    const stub = env.CHAT_ROOM.get(id);
    // A cold Durable Object (fresh isolate / evicted + restarted) can be slow
    // to answer. Bound the probe so the dashboard can never hang on it — a
    // presence gap is a "reachable: false" detail, not a dashboard failure.
    const res = await Promise.race([
      stub.fetch("https://internal/status"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("chat-room-status-timeout")), 2500)),
    ]);
    const data = (await res.json()) as { online: { user: boolean; admin: boolean } };
    return { online: data.online, reachable: true };
  } catch {
    return { online: { user: false, admin: false }, reachable: false };
  }
}

async function nicknamesMap(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare("SELECT role, nickname FROM nicknames").all<{ role: string; nickname: string }>();
  const map: Record<string, string> = {};
  for (const r of rows.results ?? []) map[r.role] = r.nickname;
  return map;
}

// ---------------------------------------------------------------------------
// Dashboard — a single lightweight overview so the landing page renders fast.
// Every slice is intentionally small (LIMIT small) — never the full history.
// ---------------------------------------------------------------------------

admin.get("/dashboard", async (c) => {
  try {
    return await dashboardPayload(c);
  } catch (err) {
    // The dashboard fans out into many D1 queries + a DO presence probe. A
    // single transient query failure must not blank the whole page or surface
    // as an opaque 500 — return a structured 503 the frontend can identify and
    // auto-retry, and log the real cause for diagnosis (never echo it to the
    // client, which could leak internal query details).
    console.error("[/admin/dashboard] failed:", err);
    return c.json({ error: "Dashboard data is temporarily unavailable." }, 503);
  }
});

async function dashboardPayload(c: Context<AppEnv>) {
  const env = c.env;
  const db = env.DB;

  const streak = await db
    .prepare("SELECT current_streak, longest_streak, last_open_date, garden_stage FROM streak WHERE id = 1")
    .first<{ current_streak: number; longest_streak: number; last_open_date: string | null; garden_stage: number }>();

  const jarToday = await db
    .prepare("SELECT date, mood, message, created_at FROM jar_entries WHERE date = ?")
    .bind(istDateString())
    .first<{ date: string; mood: string; message: string; created_at: number }>();
  const lastJar = await db
    .prepare("SELECT date, mood, created_at FROM jar_entries ORDER BY date DESC LIMIT 1")
    .first<{ date: string; mood: string; created_at: number }>();

  const pet = await db
    .prepare("SELECT name, hunger, happiness, energy, stage, last_fed_at, last_played_at FROM pet_state WHERE id = 1")
    .first<{ name: string; hunger: number; happiness: number; energy: number; stage: string; last_fed_at: number | null; last_played_at: number | null }>();

  const chat = await chatRoomStatus(env);
  const lastMessage = await db
    .prepare(
      "SELECT sender, body, kind, created_at FROM chat_messages WHERE deleted_for_everyone = 0 ORDER BY created_at DESC LIMIT 1"
    )
    .first<{ sender: string; body: string; kind: string; created_at: number }>();
  const chatCount = await db
    .prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE deleted_for_everyone = 0")
    .first<{ c: number }>();

  const recentNotifications = await db
    .prepare(
      "SELECT id, recipient, type, title, body, read_at, created_at FROM notifications ORDER BY id DESC LIMIT 5"
    )
    .all<{ id: number; recipient: string; type: string; title: string; body: string; read_at: number | null; created_at: number }>();
  const unreadAdmin = await db
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient = 'admin' AND read_at IS NULL")
    .first<{ c: number }>();
  const unreadUser = await db
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient = 'user' AND read_at IS NULL")
    .first<{ c: number }>();

  const events = await db
    .prepare(
      "SELECT id, title, description, event_date, event_time, created_by FROM calendar_events ORDER BY event_date ASC LIMIT 30"
    )
    .all<{ id: number; title: string; description: string | null; event_date: string; event_time: string | null; created_by: string }>();
  const today = istDateString();
  const upcoming = (events.results ?? []).filter((e) => {
    const diff = daysBetween(today, e.event_date);
    return diff >= 0 && diff <= 7;
  });

  const bestGame = await db
    .prepare("SELECT score, message, created_at FROM game_scores ORDER BY score DESC LIMIT 1")
    .first<{ score: number; message: string; created_at: number }>();
  const recentGames = await db
    .prepare("SELECT score, message, created_at FROM game_scores ORDER BY id DESC LIMIT 3")
    .all<{ score: number; message: string; created_at: number }>();

  const recentActions = await db
    .prepare("SELECT action, detail, created_at FROM admin_actions ORDER BY id DESC LIMIT 8")
    .all<{ action: string; detail: string; created_at: number }>();

  const pushCount = await db
    .prepare("SELECT COUNT(*) AS c FROM push_subscriptions WHERE recipient = 'admin'")
    .first<{ c: number }>();

  // Last activity for the user: the most recent of any session, login or jar open.
  const lastSession = await db
    .prepare("SELECT MAX(created_at) AS t FROM sessions WHERE role = 'user'")
    .first<{ t: number | null }>();
  const lastLogin = await db
    .prepare("SELECT MAX(created_at) AS t FROM login_attempts WHERE role = 'user' AND success = 1")
    .first<{ t: number | null }>();
  const lastActivityTs = Math.max(
    lastSession?.t ?? 0,
    lastLogin?.t ?? 0,
    lastJar?.created_at ?? 0
  );

  const names = await nicknamesMap(db);

  return c.json({
    user: {
      name: env.USER_NAME,
      userNickname: names["user"] ?? env.USER_NAME,
      loginEnabled: (await getSetting(db, "user_login_disabled")) !== "true",
      disableReason: await getSetting(db, "user_login_disabled_reason"),
      lastActivity: lastActivityTs > 0 ? lastActivityTs : null,
      security: await userLoginSecurity(db),
    },
    jar: {
      available: (await getSetting(db, "jar_available_override")) !== "false",
      today: jarToday ?? null,
      lastOpened: lastJar ?? null,
    },
    streak: streak ?? { current_streak: 0, longest_streak: 0, last_open_date: null, garden_stage: 0 },
    pet: pet ?? { name: "Pip", hunger: 0, happiness: 0, energy: 0, stage: "baby", last_fed_at: null, last_played_at: null },
    chat: {
      online: chat.online,
      reachable: chat.reachable,
      lastMessage: lastMessage ?? null,
      messageCount: chatCount?.c ?? 0,
    },
    notifications: {
      unreadAdmin: unreadAdmin?.c ?? 0,
      unreadUser: unreadUser?.c ?? 0,
      recent: recentNotifications.results ?? [],
    },
    calendar: { upcoming },
    game: { best: bestGame ?? null, recent: recentGames.results ?? [] },
    activity: { recent: recentActions.results ?? [] },
    health: {
      aiConfigured: !!env.GEMINI_API_KEY,
      weatherConfigured: !!env.WEATHER_API_KEY,
      pushConfigured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
      pushSubscriptions: pushCount?.c ?? 0,
      realtimeReachable: chat.reachable,
    },
  });
}

// ---------------------------------------------------------------------------
// User control
// ---------------------------------------------------------------------------

admin.get("/user/profile", async (c) => {
  const env = c.env;
  const db = env.DB;
  const names = await nicknamesMap(db);
  const streak = await db
    .prepare("SELECT current_streak, longest_streak FROM streak WHERE id = 1")
    .first<{ current_streak: number; longest_streak: number }>();
  const pet = await db
    .prepare("SELECT stage, happiness FROM pet_state WHERE id = 1")
    .first<{ stage: string; happiness: number }>();
  const unread = await db
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient = 'user' AND read_at IS NULL")
    .first<{ c: number }>();
  const sessionCount = await db
    .prepare("SELECT COUNT(*) AS c FROM sessions WHERE role = 'user'")
    .first<{ c: number }>();
  const lastLogin = await db
    .prepare("SELECT MAX(created_at) AS t FROM login_attempts WHERE role = 'user' AND success = 1")
    .first<{ t: number | null }>();
  const lastSession = await db
    .prepare("SELECT MAX(created_at) AS t FROM sessions WHERE role = 'user'")
    .first<{ t: number | null }>();
  const lastJar = await db
    .prepare("SELECT MAX(created_at) AS t FROM jar_entries")
    .first<{ t: number | null }>();

  const ts = Math.max(lastLogin?.t ?? 0, lastSession?.t ?? 0, lastJar?.t ?? 0);

  return c.json({
    name: env.USER_NAME,
    userNickname: names["user"] ?? env.USER_NAME,
    adminNickname: names["admin"] ?? "Admin",
    loginEnabled: (await getSetting(db, "user_login_disabled")) !== "true",
    disableReason: await getSetting(db, "user_login_disabled_reason"),
    lastActivity: ts > 0 ? ts : null,
    streak: { currentStreak: streak?.current_streak ?? 0, longestStreak: streak?.longest_streak ?? 0 },
    pet: pet ?? { stage: "baby", happiness: 0 },
    notificationsUnread: unread?.c ?? 0,
    sessions: { count: sessionCount?.c ?? 0, lastLoginAt: lastLogin?.t ?? null },
  });
});

admin.get("/user/activity", async (c) => {
  const attempts = await c.env.DB.prepare(
    "SELECT id, role, success, reason, created_at FROM login_attempts ORDER BY id DESC LIMIT 20"
  ).all<{ id: number; role: string; success: number; reason: string | null; created_at: number }>();
  const sessions = await c.env.DB.prepare(
    "SELECT role, created_at, expires_at FROM sessions ORDER BY created_at DESC LIMIT 10"
  ).all<{ role: string; created_at: number; expires_at: number }>();
  return c.json({ attempts: attempts.results ?? [], sessions: sessions.results ?? [] });
});

// User login history for the admin — the single source of truth is
// login_attempts (every attempt is retained, even after a success, so the
// history is never erased). Paginated with an id cursor (`before`); never
// returns credential material, only role/success/reason/timestamp. Users get
// 403 here because the router enforces requireAuth("admin") on /admin/*.
admin.get("/user/login-history", async (c) => {
  const db = c.env.DB;
  const beforeRaw = c.req.query("before");
  const limitRaw = c.req.query("limit");
  const before = beforeRaw !== undefined && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : undefined;
  const requested = limitRaw !== undefined && /^\d+$/.test(limitRaw) ? Number(limitRaw) : 50;
  const limit = Math.max(1, Math.min(requested, 50));
  // Fetch one extra row to know whether another page exists.
  const rows = before
    ? await db
        .prepare(
          "SELECT id, role, success, reason, created_at FROM login_attempts WHERE role = 'user' AND id < ? ORDER BY id DESC LIMIT ?"
        )
        .bind(before, limit + 1)
        .all<{ id: number; role: string; success: number; reason: string | null; created_at: number }>()
    : await db
        .prepare(
          "SELECT id, role, success, reason, created_at FROM login_attempts WHERE role = 'user' ORDER BY id DESC LIMIT ?"
        )
        .bind(limit + 1)
        .all<{ id: number; role: string; success: number; reason: string | null; created_at: number }>();
  const list = rows.results ?? [];
  const hasMore = list.length > limit;
  const attempts = hasMore ? list.slice(0, limit) : list;
  const nextBefore = hasMore ? attempts[attempts.length - 1].id : undefined;
  return c.json({
    attempts,
    nextBefore,
    summary: await userLoginSecurity(db),
  });
});

admin.post("/user/disable-login", async (c) => {
  const { disabled, reason } = await c.req.json<{ disabled?: boolean; reason?: string }>();
  if (reason !== undefined && reason.length > LIMITS.DISABLE_REASON) {
    return c.json({ error: `Reason must be ${LIMITS.DISABLE_REASON} characters or fewer` }, 400);
  }
  await setSetting(c.env.DB, "user_login_disabled", disabled ? "true" : "false");
  if (disabled) {
    await setSetting(c.env.DB, "user_login_disabled_reason", reason ?? "Login temporarily disabled.");
    // Disabling login must take effect immediately: revoke every existing user
    // session so someone already inside the app is signed out at once, not just
    // kept out of future logins.
    await revokeRoleSessions(c.env.DB, "user");
  } else {
    await setSetting(c.env.DB, "user_login_disabled_reason", "");
  }
  await logAdminAction(
    c.env.DB,
    disabled ? "login_disabled" : "login_enabled",
    disabled ? (reason ?? "Login temporarily disabled.") : "Re-enabled user login"
  );
  return c.json({ ok: true });
});

// Live user PIN change. The hash is stored in D1 (app_settings.user_pin_hash)
// and becomes the active credential immediately — no `wrangler secret put`, no
// redeploy. All existing user sessions are revoked so the old PIN can't keep
// the app unlocked. If `requestId` is supplied and matches a pending user reset
// request, that request is marked approved at the same time.
admin.post("/user/set-pin", async (c) => {
  const { pin, requestId } = await c.req.json<{ pin?: string; requestId?: number }>();
  if (!pin || !/^\d{6}$/.test(pin)) return c.json({ error: "PIN must be 6 digits" }, 400);
  const hash = await hashSecret(pin);
  await setSetting(c.env.DB, "user_pin_hash", hash);
  await revokeRoleSessions(c.env.DB, "user");
  const reqId = requestId !== undefined ? Number(requestId) : undefined;
  if (reqId !== undefined && !Number.isNaN(reqId)) {
    const row = await c.env.DB
      .prepare("SELECT role, status FROM password_reset_requests WHERE id = ?")
      .bind(reqId)
      .first<{ role: string; status: string }>();
    if (row && row.role === "user" && row.status === "pending") {
      await c.env.DB
        .prepare("UPDATE password_reset_requests SET status = 'approved', resolved_at = unixepoch() WHERE id = ?")
        .bind(reqId)
        .run();
    }
  }
  await logAdminAction(c.env.DB, "pin_set", `Set a new user PIN (request #${reqId ?? "manual"}); revoked user sessions`);
  return c.json({ ok: true, message: "New PIN saved and active. The user's other sessions were signed out." });
});

// Live admin password change. Stored in D1 (app_settings.admin_password_hash),
// active immediately. Revokes all OTHER admin sessions (the current session
// stays so the admin isn't logged out mid-action).
admin.post("/reset-admin-password", async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  if (!password || password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
  if (password.length > LIMITS.ADMIN_PASSWORD_MAX) {
    return c.json({ error: `Password must be ${LIMITS.ADMIN_PASSWORD_MAX} characters or fewer` }, 400);
  }
  const hash = await hashSecret(password);
  await setSetting(c.env.DB, "admin_password_hash", hash);
  await revokeAdminSessionsExcept(c.env.DB, c.get("token"));
  await logAdminAction(c.env.DB, "admin_password_set", "Set a new admin password; revoked other admin sessions");
  return c.json({ ok: true, message: "New password saved and active. Other admin sessions were signed out." });
});

admin.get("/reset-requests", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, role, status, reason, created_at, resolved_at FROM password_reset_requests ORDER BY created_at DESC"
  ).all();
  return c.json({ requests: rows.results ?? [] });
});

// Explicitly approve one specific pending user reset request. Applies the PIN
// the user actually chose (stored on the request) as the new live credential in
// D1 and revokes the user's other sessions.
admin.post("/reset-requests/:id/approve", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare("SELECT role, status, new_pin_hash FROM password_reset_requests WHERE id = ?")
    .bind(id)
    .first<{ role: string; status: string; new_pin_hash: string | null }>();
  if (!row) return c.json({ error: "Request not found" }, 404);
  if (row.status !== "pending") return c.json({ error: "Request already resolved" }, 400);
  if (row.role !== "user" || !row.new_pin_hash) {
    return c.json({ error: "This request has no user PIN to approve" }, 400);
  }
  await setSetting(c.env.DB, "user_pin_hash", row.new_pin_hash);
  await revokeRoleSessions(c.env.DB, "user");
  await c.env.DB
    .prepare("UPDATE password_reset_requests SET status = 'approved', resolved_at = unixepoch() WHERE id = ?")
    .bind(id)
    .run();
  await logAdminAction(c.env.DB, "pin_approved", `Approved PIN reset request #${id}; revoked user sessions`);
  return c.json({ ok: true, message: "Reset approved — the user's chosen PIN is now active." });
});

admin.post("/reset-requests/:id/deny", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB
    .prepare("UPDATE password_reset_requests SET status = 'denied', resolved_at = unixepoch() WHERE id = ?")
    .bind(id)
    .run();
  if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Request not found" }, 404);
  await logAdminAction(c.env.DB, "pin_denied", `Denied PIN reset request #${id}`);
  return c.json({ ok: true });
});

// --- Nicknames (each role sets what the *other* is called) ---

admin.get("/nicknames", async (c) => {
  const rows = await c.env.DB.prepare("SELECT role, nickname FROM nicknames").all();
  return c.json({ nicknames: rows.results ?? [] });
});

admin.post("/nicknames", async (c) => {
  const { forRole, nickname } = await c.req.json<{ forRole?: "user" | "admin"; nickname?: string }>();
  if (!forRole || !nickname) return c.json({ error: "forRole and nickname required" }, 400);
  if (nickname.length > LIMITS.NICKNAME) {
    return c.json({ error: `Nickname must be ${LIMITS.NICKNAME} characters or fewer` }, 400);
  }
  await c.env.DB
    .prepare(
      "INSERT INTO nicknames (role, nickname) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET nickname = excluded.nickname"
    )
    .bind(forRole, nickname)
    .run();
  await logAdminAction(c.env.DB, "nickname_set", `Set nickname for ${forRole} to "${nickname}"`);
  return c.json({ ok: true });
});

// Reset a nickname back to its default (user → USER_NAME, admin → "Admin").
admin.delete("/nicknames/:role", async (c) => {
  const role = c.req.param("role");
  if (role !== "user" && role !== "admin") return c.json({ error: "Invalid role" }, 400);
  await c.env.DB.prepare("DELETE FROM nicknames WHERE role = ?").bind(role).run();
  await logAdminAction(c.env.DB, "nickname_reset", `Reset the ${role} nickname to default`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Love Jar control
// ---------------------------------------------------------------------------

admin.post("/jar/streak", async (c) => {
  const { currentStreak, longestStreak, reason } = await c.req.json<{
    currentStreak?: number;
    longestStreak?: number;
    reason?: string;
  }>();
  if (currentStreak === undefined && longestStreak === undefined) {
    return c.json({ error: "Provide currentStreak and/or longestStreak" }, 400);
  }
  const validate = (n: number) => Number.isInteger(n) && n >= 0 && n <= LIMITS.STREAK_MAX;
  if (currentStreak !== undefined && !validate(currentStreak)) {
    return c.json({ error: `Current streak must be a whole number between 0 and ${LIMITS.STREAK_MAX}` }, 400);
  }
  if (longestStreak !== undefined && !validate(longestStreak)) {
    return c.json({ error: `Longest streak must be a whole number between 0 and ${LIMITS.STREAK_MAX}` }, 400);
  }
  const row = await c.env.DB
    .prepare("SELECT current_streak, longest_streak FROM streak WHERE id = 1")
    .first<{ current_streak: number; longest_streak: number }>();
  const finalCurrent = currentStreak ?? row?.current_streak ?? 0;
  const finalLongest = Math.max(longestStreak ?? row?.longest_streak ?? 0, finalCurrent);
  const gardenStage = finalCurrent >= 30 ? Math.min(5, Math.floor(finalCurrent / 30)) : 0;
  await c.env.DB.prepare(
    "UPDATE streak SET " +
      "current_streak = ?, " +
      "longest_streak = ?, " +
      "garden_stage = ?, " +
      "updated_at = unixepoch() WHERE id = 1"
  )
    .bind(finalCurrent, finalLongest, gardenStage)
    .run();
  await logAdminAction(
    c.env.DB,
    "streak_adjusted",
    `Streak set to ${finalCurrent} (longest ${finalLongest})${reason ? ` — ${reason}` : ""}`
  );
  return c.json({ ok: true, currentStreak: finalCurrent, longestStreak: finalLongest, gardenStage });
});

admin.post("/jar/availability", async (c) => {
  const { available } = await c.req.json<{ available?: boolean }>();
  await setSetting(c.env.DB, "jar_available_override", available === false ? "false" : "true");
  await logAdminAction(c.env.DB, available === false ? "jar_paused" : "jar_resumed", "Toggled jar availability");
  return c.json({ ok: true });
});

admin.get("/jar/status", async (c) => {
  const db = c.env.DB;
  const today = istDateString();
  const todayEntry = await db
    .prepare("SELECT date, mood, message, created_at FROM jar_entries WHERE date = ?")
    .bind(today)
    .first<{ date: string; mood: string; message: string; created_at: number }>();
  const lastGeneration = await db
    .prepare("SELECT mood, message, source, created_at FROM ai_message_history ORDER BY id DESC LIMIT 1")
    .first<{ mood: string; message: string; source: string; created_at: number }>();
  const geminiCount = await db
    .prepare("SELECT COUNT(*) AS c FROM ai_message_history WHERE source = 'gemini'")
    .first<{ c: number }>();
  const fallbackCount = await db
    .prepare("SELECT COUNT(*) AS c FROM ai_message_history WHERE source = 'fallback'")
    .first<{ c: number }>();
  return c.json({
    available: (await getSetting(db, "jar_available_override")) !== "false",
    today: todayEntry ?? null,
    ai: {
      configured: !!c.env.GEMINI_API_KEY,
      lastGeneration: lastGeneration ?? null,
      counts: { gemini: geminiCount?.c ?? 0, fallback: fallbackCount?.c ?? 0 },
    },
  });
});

admin.get("/jar/entries", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT date, mood, message, created_at FROM jar_entries ORDER BY date DESC LIMIT 30"
  ).all();
  return c.json({ entries: rows.results ?? [] });
});

// --- Global feature/notification controls ---
// These keys (mute_all, sound_enabled, vibration_enabled) are legacy/dead:
// nothing reads them, so they are intentionally NOT surfaced in the UI. The
// endpoint is kept only for backward compatibility with older clients.

admin.post("/settings/global", async (c) => {
  const body = await c.req.json<Record<string, boolean>>();
  for (const [key, value] of Object.entries(body)) {
    if (["mute_all", "sound_enabled", "vibration_enabled"].includes(key)) {
      await setSetting(c.env.DB, key, value ? "true" : "false");
    }
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const NOTIFICATION_TYPES = [
  "chat",
  "hug",
  "kiss",
  "jar",
  "streak",
  "letter",
  "bucket",
  "calendar",
  "pet",
  "game",
  "security",
] as const;

admin.get("/notifications", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, recipient, type, title, body, reference_id, read_at, created_at " +
      "FROM notifications ORDER BY id DESC LIMIT 50"
  ).all<{
    id: number;
    recipient: string;
    type: string;
    title: string;
    body: string;
    reference_id: number | null;
    read_at: number | null;
    created_at: number;
  }>();
  const unreadUser = await c.env.DB
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient = 'user' AND read_at IS NULL")
    .first<{ c: number }>();
  const unreadAdmin = await c.env.DB
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient = 'admin' AND read_at IS NULL")
    .first<{ c: number }>();
  return c.json({ notifications: rows.results ?? [], unreadUser: unreadUser?.c ?? 0, unreadAdmin: unreadAdmin?.c ?? 0 });
});

admin.post("/notifications/send", async (c) => {
  const { recipient, type, title, body } = await c.req.json<{
    recipient?: string;
    type?: string;
    title?: string;
    body?: string;
  }>();
  if (recipient !== "user" && recipient !== "admin") {
    return c.json({ error: "recipient must be 'user' or 'admin'" }, 400);
  }
  if (!type || !(NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    return c.json({ error: `type must be one of: ${NOTIFICATION_TYPES.join(", ")}` }, 400);
  }
  if (!title || title.trim().length === 0) return c.json({ error: "Title required" }, 400);
  if (title.length > LIMITS.NOTIFICATION_TITLE) {
    return c.json({ error: `Title must be ${LIMITS.NOTIFICATION_TITLE} characters or fewer` }, 400);
  }
  if (!body || body.trim().length === 0) return c.json({ error: "Message required" }, 400);
  if (body.length > LIMITS.NOTIFICATION_BODY) {
    return c.json({ error: `Message must be ${LIMITS.NOTIFICATION_BODY} characters or fewer` }, 400);
  }
  const { notify } = await import("../lib/notifications");
  await notify(c.env, recipient, type as (typeof NOTIFICATION_TYPES)[number], title.trim(), body.trim());
  await logAdminAction(c.env.DB, "notification_sent", `Sent a "${type}" notification to ${recipient}: "${title.trim()}"`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

admin.get("/game/scores", async (c) => {
  const best = await c.env.DB
    .prepare("SELECT score, message, created_at FROM game_scores ORDER BY score DESC LIMIT 1")
    .first<{ score: number; message: string; created_at: number }>();
  const recent = await c.env.DB
    .prepare("SELECT score, message, created_at FROM game_scores ORDER BY id DESC LIMIT 10")
    .all<{ score: number; message: string; created_at: number }>();
  return c.json({ best: best ?? null, recent: recent.results ?? [], maxScore: 25 });
});

admin.get("/weather/status", async (c) => {
  const cached = await c.env.DB.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'last_weather'").first<{
    value: string;
    updated_at: number;
  }>();
  let parsed: unknown = null;
  if (cached) {
    try {
      parsed = JSON.parse(cached.value);
    } catch {
      parsed = null;
    }
  }
  return c.json({
    configured: !!c.env.WEATHER_API_KEY,
    cached: parsed,
    updatedAt: cached?.updated_at ?? null,
  });
});

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

admin.get("/system/health", async (c) => {
  const env = c.env;
  const checks: { key: string; label: string; status: "ok" | "warn" | "error"; detail: string }[] = [];

  let dbOk = true;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
  } catch {
    dbOk = false;
  }
  checks.push({
    key: "backend",
    label: "Backend API",
    status: "ok",
    detail: "Reachable",
  });
  checks.push({
    key: "db",
    label: "Database (D1)",
    status: dbOk ? "ok" : "error",
    detail: dbOk ? "Healthy" : "Unreachable",
  });
  checks.push({
    key: "ai",
    label: "AI (Gemini)",
    status: env.GEMINI_API_KEY ? "ok" : "warn",
    detail: env.GEMINI_API_KEY ? "Configured — jar uses live AI with a fallback bank" : "Not configured — jar uses the fallback bank",
  });
  checks.push({
    key: "weather",
    label: "Weather API",
    status: env.WEATHER_API_KEY ? "ok" : "warn",
    detail: env.WEATHER_API_KEY ? "Configured" : "Not configured — weather unavailable",
  });
  const pushConfigured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  checks.push({
    key: "push",
    label: "Web Push (admin)",
    status: pushConfigured ? "ok" : "warn",
    detail: pushConfigured ? "VAPID configured" : "VAPID keys not configured — no browser push",
  });
  checks.push({
    key: "notifications",
    label: "In-app notifications",
    status: dbOk ? "ok" : "error",
    detail: dbOk ? "Healthy" : "Unavailable (DB down)",
  });
  const chat = await chatRoomStatus(env);
  checks.push({
    key: "realtime",
    label: "Realtime (Chat)",
    status: chat.reachable ? "ok" : "warn",
    detail: chat.reachable ? "Durable Object reachable" : "Chat Durable Object unreachable",
  });

  return c.json({ checks });
});

admin.get("/system/security", async (c) => {
  const db = c.env.DB;
  const pendingPin = await db
    .prepare("SELECT COUNT(*) AS c FROM password_reset_requests WHERE status = 'pending'")
    .first<{ c: number }>();
  const adminSessions = await db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE role = 'admin'").first<{ c: number }>();
  const userSessions = await db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE role = 'user'").first<{ c: number }>();
  const failedUser24h = await db
    .prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE role = 'user' AND success = 0 AND created_at >= ?")
    .bind(Math.floor(Date.now() / 1000) - 86400)
    .first<{ c: number }>();
  const failedAdmin24h = await db
    .prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE role = 'admin' AND success = 0 AND created_at >= ?")
    .bind(Math.floor(Date.now() / 1000) - 86400)
    .first<{ c: number }>();
  const pushCount = await db
    .prepare("SELECT COUNT(*) AS c FROM push_subscriptions WHERE recipient = 'admin'")
    .first<{ c: number }>();
  const lastPush = await db
    .prepare("SELECT MAX(last_seen_at) AS t FROM push_subscriptions WHERE recipient = 'admin'")
    .first<{ t: number | null }>();
  const lastAdminLogin = await db
    .prepare("SELECT MAX(created_at) AS t FROM login_attempts WHERE role = 'admin' AND success = 1")
    .first<{ t: number | null }>();

  return c.json({
    loginEnabled: (await getSetting(db, "user_login_disabled")) !== "true",
    disableReason: await getSetting(db, "user_login_disabled_reason"),
    pendingPinRequests: pendingPin?.c ?? 0,
    sessions: {
      admin: adminSessions?.c ?? 0,
      user: userSessions?.c ?? 0,
      lastAdminLoginAt: lastAdminLogin?.t ?? null,
    },
    credentials: {
      userPinOverride: (await getSetting(db, "user_pin_hash")) !== null,
      adminPasswordOverride: (await getSetting(db, "admin_password_hash")) !== null,
    },
    rateLimit: {
      windowSeconds: LIMITS.AUTH_FAIL_WINDOW_SECONDS,
      maxFailures: LIMITS.AUTH_MAX_FAILURES,
      failedUserLast24h: failedUser24h?.c ?? 0,
      failedAdminLast24h: failedAdmin24h?.c ?? 0,
    },
    push: {
      configured: !!(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY && c.env.VAPID_SUBJECT),
      subscriptions: pushCount?.c ?? 0,
      lastSeenAt: lastPush?.t ?? null,
    },
  });
});

// Revert a live credential override back to the default Worker secret
// (USER_PIN_HASH / ADMIN_PASSWORD_HASH). This is the recovery path: delete the
// D1 override and the app authenticates against the secret again. Sessions are
// revoked on the affected role (admin keeps its own session).
admin.post("/credentials/revert", async (c) => {
  const { which } = await c.req.json<{ which?: "user" | "admin" }>();
  if (which !== "user" && which !== "admin") return c.json({ error: "which must be user or admin" }, 400);
  if (which === "user") {
    await c.env.DB.prepare("DELETE FROM app_settings WHERE key = 'user_pin_hash'").run();
    await revokeRoleSessions(c.env.DB, "user");
    await logAdminAction(c.env.DB, "pin_reverted", "Reverted the user PIN to the default secret");
  } else {
    await c.env.DB.prepare("DELETE FROM app_settings WHERE key = 'admin_password_hash'").run();
    await revokeAdminSessionsExcept(c.env.DB, c.get("token"));
    await logAdminAction(c.env.DB, "admin_password_reverted", "Reverted the admin password to the default secret");
  }
  return c.json({ ok: true, message: "Reverted to the default credential." });
});

admin.get("/system/configuration", async (c) => {
  return c.json({
    appName: "LoveJar",
    userName: c.env.USER_NAME,
    adminEmail: c.env.ADMIN_EMAIL,
    timezone: {
      offsetMinutes: Number(c.env.APP_TIMEZONE_OFFSET_MINUTES) || 330,
      label: "IST (UTC+5:30)",
    },
    aiConfigured: !!c.env.GEMINI_API_KEY,
    weatherConfigured: !!c.env.WEATHER_API_KEY,
    pushConfigured: !!(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY && c.env.VAPID_SUBJECT),
  });
});

// Where to point external uptime monitors. Generic HTTP health endpoints only —
// LoveJar never stores or manages provider API keys, so monitors are registered
// manually on the provider's side using these URLs.
admin.get("/system/monitoring", async (c) => {
  return c.json({
    endpoints: [
      {
        path: "/health",
        method: "GET",
        auth: "public",
        okStatus: 200,
        description: "Basic liveness. No dependencies; 200 whenever the worker is alive.",
      },
      {
        path: "/health/ready",
        method: "GET",
        auth: "public",
        okStatus: 200,
        description: "Readiness. Verifies the D1 database is reachable. Returns 503 when a required dependency is unavailable.",
      },
      {
        path: "/health/details",
        method: "GET",
        auth: "admin only",
        okStatus: 200,
        description: "Detailed diagnostics (database, realtime, notifications, push, AI, weather). Never returns secrets.",
      },
    ],
    note: "In UptimeRobot / Better Uptime / Cronitor, add a GET check on /health (and optionally /health/ready) with '200' as the up status. No provider credentials are stored in LoveJar.",
  });
});

admin.get("/activity", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT action, detail, created_at FROM admin_actions ORDER BY id DESC LIMIT 50"
  ).all<{ action: string; detail: string; created_at: number }>();
  return c.json({ actions: rows.results ?? [] });
});

export default admin;
