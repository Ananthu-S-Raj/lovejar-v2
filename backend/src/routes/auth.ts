import { Hono } from "hono";
import type { AppEnv } from "../types";
import { createSession, sessionCookie, clearSessionCookie, verifySecret, hashSecret, parseCookie, getSession, getSetting, activeCredentialHash, ADMIN_COOKIE, USER_COOKIE } from "../lib/auth-utils";
import { notify } from "../lib/notifications";
import { logAdminAction } from "../lib/admin-log";
import { LIMITS } from "../lib/limits";

const auth = new Hono<AppEnv>();

// Brute-force protection: N failed attempts within a rolling window temporarily
// blocks further attempts for that role. Deliberately keyed per-role (this is a
// two-person app) and kept simple — no external dependencies, backed by D1.
const FAIL_WINDOW_SECONDS = LIMITS.AUTH_FAIL_WINDOW_SECONDS;
const MAX_FAILURES = LIMITS.AUTH_MAX_FAILURES;

// Count a role's failed attempts inside the rolling rate-limit window. Failures
// before the most recent successful login (within the window) are ignored. This
// reproduces the original "counter resets on success" behavior WITHOUT deleting
// history: login_attempts keeps every record, so the admin's login-history view
// retains failures even after a successful login.
export async function recentFailures(db: D1Database, role: string, now: number): Promise<number> {
  const cutoff = now - FAIL_WINDOW_SECONDS;
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS c FROM login_attempts la " +
        "WHERE la.role = ? AND la.success = 0 AND la.created_at >= ? " +
        "AND la.id > COALESCE((SELECT MAX(id) FROM login_attempts WHERE role = ? AND success = 1 AND created_at >= ?), 0)"
    )
    .bind(role, cutoff, role, cutoff)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

// Deliver one admin security alert per rate-limit window. The title is the
// stable dedup key: the same alert (e.g. lockout) can exist at most once inside
// a window, so a burst of failed attempts never produces a notification per
// attempt. The live in-app chat signal is fired alongside so the admin sees it
// even when they have the app open.
async function securityAlert(env: AppEnv["Bindings"], title: string, body: string, referenceId: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(
    "SELECT id FROM notifications WHERE recipient = 'admin' AND type = 'security' AND title = ? AND created_at >= ? ORDER BY id DESC LIMIT 1"
  )
    .bind(title, now - FAIL_WINDOW_SECONDS)
    .first();
  if (existing) return;
  try {
    const id = env.CHAT_ROOM.idFromName("lovejar-chat");
    const stub = env.CHAT_ROOM.get(id);
    await stub.fetch("https://internal/notify", {
      method: "POST",
      body: JSON.stringify({ type: "failed_login", message: title }),
    });
  } catch {
    // non-fatal
  }
  await notify(env, "admin", "security", title, body, referenceId);
}

// Public status the login screen can poll: whether the user login is currently
// disabled and why. This lets the user's app surface a clear "login is
// disabled" state and detect re-enabling live, without any authenticated call.
auth.get("/user/status", async (c) => {
  const disabled = await getSetting(c.env.DB, "user_login_disabled");
  const reason = (await getSetting(c.env.DB, "user_login_disabled_reason")) ?? "Login is currently disabled.";
  return c.json({ enabled: disabled !== "true", reason });
});

// POST /auth/user/login  { pin }
auth.post("/user/login", async (c) => {
  const { pin } = await c.req.json<{ pin?: string }>();
  if (!pin || !/^\d{6}$/.test(pin)) {
    return c.json({ error: "Invalid PIN" }, 400);
  }

  const disabled = await getSetting(c.env.DB, "user_login_disabled");
  if (disabled === "true") {
    const reason = (await getSetting(c.env.DB, "user_login_disabled_reason")) ?? "Login is currently disabled.";
    return c.json({ error: "Login is currently disabled.", reason, code: "login_disabled" }, 423);
  }

  const now = Math.floor(Date.now() / 1000);
  const locked = await recentFailures(c.env.DB, "user", now);
  if (locked >= MAX_FAILURES) {
    // Record the blocked attempt so the admin's login history shows exactly when
    // the rate limit engaged. Same response as a wrong PIN so lockout state is
    // not revealed; the alert is deduped to once per window.
    const result = await c.env.DB.prepare(
      "INSERT INTO login_attempts (role, success, reason, created_at) VALUES ('user', 0, 'locked', ?)"
    )
      .bind(now)
      .run();
    await securityAlert(
      c.env,
      "Login temporarily blocked",
      `${c.env.USER_NAME}'s account is temporarily blocked — repeated unsuccessful attempts triggered the login protection.`,
      Number(result.meta.last_row_id)
    );
    return c.json({ error: "Wrong password", failCount: locked }, 401);
  }

  // The active PIN hash is the D1 override if the admin set one live, else the
  // USER_PIN_HASH Worker secret (bootstrap/recovery). The override is the SINGLE
  // effective credential — while it exists the old secret is not accepted, so a
  // changed PIN always replaces the old one.
  const activePinHash = await activeCredentialHash(c.env.DB, "user_pin_hash", c.env.USER_PIN_HASH);
  const ok = await verifySecret(pin, activePinHash);
  const result = await c.env.DB.prepare(
    "INSERT INTO login_attempts (role, success, reason, created_at) VALUES ('user', ?, ?, ?)"
  )
    .bind(ok ? 1 : 0, ok ? null : "failed_pin", now)
    .run();
  const attemptId = Number(result.meta.last_row_id);

  if (!ok) {
    // failCount counts only this burst (failures since the last successful
    // login inside the window, including this one) so the UI can phrase the
    // message correctly and the alert thresholds below stay stable.
    const failCount = await recentFailures(c.env.DB, "user", now);
    if (failCount === 3) {
      // Third failure in a burst → first meaningful alert. Not repeated on the
      // fourth failure (failCount is then 4), and never per-attempt.
      await securityAlert(
        c.env,
        "Multiple failed login attempts",
        `${c.env.USER_NAME}'s account received multiple unsuccessful PIN attempts.`,
        attemptId
      );
    } else if (failCount >= MAX_FAILURES) {
      // The attempt that crosses the lockout threshold.
      await securityAlert(
        c.env,
        "Login temporarily blocked",
        `${c.env.USER_NAME}'s account is temporarily blocked — repeated unsuccessful attempts triggered the login protection.`,
        attemptId
      );
    }
    return c.json({ error: "Wrong password", failCount }, 401);
  }

  const { token, expiresAt } = await createSession(c.env.DB, "user");
  c.header("Set-Cookie", sessionCookie(token, expiresAt));
  return c.json({ ok: true, greetingName: c.env.USER_NAME });
});

// POST /auth/admin/login { email, password }
auth.post("/admin/login", async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>();
  if (!email || !password) return c.json({ error: "Email and password required" }, 400);

  const now = Math.floor(Date.now() / 1000);
  if ((await recentFailures(c.env.DB, "admin", now)) >= MAX_FAILURES) {
    // Same response as bad credentials so lockout state is not revealed.
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const emailOk = email.trim().toLowerCase() === c.env.ADMIN_EMAIL.trim().toLowerCase();
  // Always run the PBKDF2 verification so the response time does not reveal
  // whether the email address is valid. The active admin password hash is the
  // D1 override if the admin set one live, else the ADMIN_PASSWORD_HASH Worker
  // secret (bootstrap/recovery). The override is the SINGLE effective
  // credential — the Worker secret is ignored while it exists.
  const activeAdminHash = await activeCredentialHash(c.env.DB, "admin_password_hash", c.env.ADMIN_PASSWORD_HASH);
  const passOk = await verifySecret(password, activeAdminHash);
  const ok = emailOk && passOk;
  await c.env.DB.prepare("INSERT INTO login_attempts (role, success, reason, created_at) VALUES ('admin', ?, ?, ?)")
    .bind(ok ? 1 : 0, ok ? null : "failed_pin", now)
    .run();

  if (!ok) return c.json({ error: "Invalid email or password" }, 401);

  const { token, expiresAt } = await createSession(c.env.DB, "admin");
  c.header("Set-Cookie", sessionCookie(token, expiresAt, ADMIN_COOKIE));
  await logAdminAction(c.env.DB, "admin_login", "Admin signed in");
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  // Revoke the session(s) the browser currently holds server-side, not just
  // clear the cookies. The two roles use separate cookies, so an admin logout
  // here does not sign out a user session in the same browser (and vice versa).
  const cookieHeader = c.req.header("cookie") ?? null;
  const adminToken = parseCookie(cookieHeader, ADMIN_COOKIE);
  const userToken = parseCookie(cookieHeader, USER_COOKIE);
  const adminSession = adminToken ? await getSession(c.env.DB, adminToken) : null;
  const userSession = userToken ? await getSession(c.env.DB, userToken) : null;
  let cleared = 0;
  if (adminSession) {
    await logAdminAction(c.env.DB, "admin_logout", "Admin signed out");
    await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(adminToken).run();
    c.header("Set-Cookie", clearSessionCookie(ADMIN_COOKIE));
    cleared++;
  }
  if (userSession) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(userToken).run();
    c.header("Set-Cookie", clearSessionCookie(USER_COOKIE), { append: true });
    cleared++;
  }
  // Best-effort: clear whichever cookies exist even if no session row matched.
  if (!adminSession) {
    c.header("Set-Cookie", clearSessionCookie(ADMIN_COOKIE), { append: cleared++ > 0 });
  }
  if (!userSession) {
    c.header("Set-Cookie", clearSessionCookie(USER_COOKIE), { append: true });
  }
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  // /auth/me is role-agnostic: report the role of whichever session cookie the
  // browser holds. Admin is checked first so a browser that has both resolves
  // to admin (the privileged identity).
  const cookieHeader = c.req.header("cookie") ?? null;
  const adminToken = parseCookie(cookieHeader, ADMIN_COOKIE);
  if (adminToken) {
    const adminSession = await getSession(c.env.DB, adminToken);
    if (adminSession) return c.json({ authenticated: true, role: "admin" });
  }
  const userToken = parseCookie(cookieHeader, USER_COOKIE);
  if (userToken) {
    const userSession = await getSession(c.env.DB, userToken);
    if (userSession) return c.json({ authenticated: true, role: "user" });
  }
  return c.json({ authenticated: false });
});

// User forgot-password: creates a request; admin must approve via /admin/reset-requests
auth.post("/user/forgot-password", async (c) => {
  const { newPin, reason } = await c.req.json<{ newPin?: string; reason?: string }>();
  if (!newPin || !/^\d{6}$/.test(newPin)) {
    return c.json({ error: "New PIN must be 6 digits" }, 400);
  }
  if (reason !== undefined && reason.length > LIMITS.RESET_REASON) {
    return c.json({ error: `Reason must be ${LIMITS.RESET_REASON} characters or fewer` }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  // Spam guard: this endpoint is unauthenticated (the user must be able to use
  // it while locked out), so cap requests inside the auth failure window and
  // refuse while an unresolved request is already pending. Without this an
  // attacker could flood the admin's notification center with reset requests.
  const recentCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS c FROM password_reset_requests WHERE role = 'user' AND created_at >= ?"
  )
    .bind(now - FAIL_WINDOW_SECONDS)
    .first<{ c: number }>();
  if ((recentCount?.c ?? 0) >= MAX_FAILURES) {
    return c.json({ error: "Too many reset requests. Try again later." }, 429);
  }
  const pending = await c.env.DB.prepare(
    "SELECT id FROM password_reset_requests WHERE role = 'user' AND status = 'pending' LIMIT 1"
  ).first();
  if (pending) {
    return c.json({ error: "A reset request is already pending approval." }, 409);
  }

  const hash = await hashSecret(newPin);
  await c.env.DB.prepare(
    "INSERT INTO password_reset_requests (role, status, new_pin_hash, reason, created_at) VALUES ('user','pending', ?, ?, ?)"
  )
    .bind(hash, reason ?? null, now)
    .run();
  await notify(c.env, "admin", "security", "Password reset requested", `${c.env.USER_NAME} requested a new PIN — approve or deny it.`);
  return c.json({ ok: true, message: "Reset request sent to admin for approval." });
});

// Admin forgot-password: same request flow, resolved by admin themselves after re-auth in practice,
// but modeled the same way for consistency / audit trail.
auth.post("/admin/forgot-password", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO password_reset_requests (role, status, created_at) VALUES ('admin','pending', ?)"
  )
    .bind(now)
    .run();
  return c.json({ ok: true, message: "Reset request logged. Reset the admin password from Settings once verified." });
});

export default auth;
