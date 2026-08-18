// Security regression tests for LoveJar's cross-origin authentication,
// CORS and CSRF/origin policy.
//
// Run via: npm test  (bundles this file with esbuild, then runs node --test)
// No external dependencies beyond what wrangler already ships (esbuild).

import { test } from "node:test";
import assert from "node:assert/strict";

import app from "../src/index";
import { hashSecret } from "../src/lib/auth-utils";
import { allowedOrigins, originAllowed, isProduction } from "../src/lib/security";

const PIN = "123456";
const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "correct horse battery";

const PROD = "production";
const DEV = "development";
const PROD_ORIGIN = "https://lovejar-v2.pages.dev";
const EVIL_ORIGIN = "https://evil.example.com";
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174"];

let USER_PIN_HASH = "";
let ADMIN_PASSWORD_HASH = "";
let hashReady: Promise<void> | null = null;

async function ensureHashes(): Promise<void> {
  hashReady ??= (async () => {
    USER_PIN_HASH = await hashSecret(PIN);
    ADMIN_PASSWORD_HASH = await hashSecret(ADMIN_PASSWORD);
  })();
  return hashReady;
}

// ---------------------------------------------------------------------------
// Minimal in-memory D1 double. It only understands the statements the tested
// flows actually issue; any other SQL fails loudly so a new query can't be
// silently ignored by the suite.
// ---------------------------------------------------------------------------

type SessionRow = { token: string; role: string; created_at: number; expires_at: number };
type AttemptRow = { id: number; role: string; success: number; reason: string | null; created_at: number };

class FakeD1 {
  sessions: SessionRow[] = [];
  loginAttempts: AttemptRow[] = [];
  appSettings = new Map<string, string>();
  nicknames = new Map<string, string>();
  private nextAttemptId = 1;

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  doRun(sql: string, args: unknown[]): { success: boolean; meta: { last_row_id: number; changes: number } } {
    const s = normalize(sql);
    if (s.includes("insert into login_attempts")) {
      // Normal failed/successful login:
      // role is hardcoded as 'admin'/'user'; success, reason and created_at
      // are the bound arguments.
      if (s.includes("values ('admin', 0, 'locked', ?)")) {
        const createdAt = Number(args[0]);
        this.loginAttempts.push({
          id: this.nextAttemptId++,
          role: "admin",
          success: 0,
          reason: "locked",
          created_at: createdAt,
        });
      } else {
        const [success, reason, createdAt] = args;
        const roleMatch = s.match(/values \('([^']+)', \?, \?, \?\)/);
        const role = roleMatch?.[1] ?? "unknown";

        this.loginAttempts.push({
          id: this.nextAttemptId++,
          role,
          success: success as number,
          reason: (reason as string) ?? null,
          created_at: createdAt as number,
        });
      }

      return {
        success: true,
        meta: {
          last_row_id: this.nextAttemptId - 1,
          changes: 1,
        },
      };
    }
    if (s.includes("insert into sessions")) {
      const [token, role, createdAt, expiresAt] = args;
      this.sessions.push({
        token: token as string,
        role: role as string,
        created_at: createdAt as number,
        expires_at: expiresAt as number,
      });
      return { success: true, meta: { last_row_id: this.sessions.length, changes: 1 } };
    }
    if (s.includes("delete from sessions")) {
      const before = this.sessions.length;
      if (s.includes("where role = ?")) {
        const role = args[0];
        this.sessions = this.sessions.filter((r) => r.role !== role);
      } else {
        const token = args[0];
        this.sessions = this.sessions.filter((r) => r.token !== token);
      }
      return { success: true, meta: { last_row_id: 0, changes: before - this.sessions.length } };
    }
    if (s.includes("insert into admin_actions")) {
      return { success: true, meta: { last_row_id: 1, changes: 1 } };
    }
    if (s.includes("insert into nicknames")) {
      this.nicknames.set("admin", String(args[0] ?? ""));
      return { success: true, meta: { last_row_id: 1, changes: 1 } };
    }
    if (s.includes("update notifications set read_at")) {
      return { success: true, meta: { last_row_id: 0, changes: 1 } };
    }
    if (s.includes("insert into notifications")) {
      return { success: true, meta: { last_row_id: 1, changes: 1 } };
    }
    throw new Error(`FakeD1: unhandled write SQL: ${sql}`);
  }

  doFirst<T = unknown>(sql: string, args: unknown[]): T | null {
    const s = normalize(sql);
    if (s.includes("select value from app_settings where key = ?")) {
      const value = this.appSettings.get(String(args[0]));
      return value === undefined ? null : ({ value } as T);
    }
    if (s.includes("select token, role, expires_at from sessions where token = ?")) {
      const row = this.sessions.find((r) => r.token === String(args[0]));
      return row ? ({ token: row.token, role: row.role, expires_at: row.expires_at } as T) : null;
    }
    if (s.includes("select count(*) as c from login_attempts la")) {
      const role = String(args[0]);
      const cutoff = Number(args[1]);
      const lastSuccessId = this.loginAttempts
        .filter((a) => a.role === role && a.success === 1 && a.created_at >= cutoff)
        .reduce((max, a) => Math.max(max, a.id), 0);
      const c = this.loginAttempts.filter(
        (a) => a.role === role && a.success === 0 && a.created_at >= cutoff && a.id > lastSuccessId
      ).length;
      return { c } as T;
    }
    if (s.includes("select 1 as ok")) {
      return { ok: 1 } as T;
    }
    if (s.includes("select id from notifications where")) {
      return null;
    }
    throw new Error(`FakeD1: unhandled read SQL: ${sql}`);
  }

  doAll<T = unknown>(sql: string, args: unknown[]): { success: boolean; results: T[] } {
    const s = normalize(sql);
    if (s.includes("select count(*) as c from login_attempts la")) {
      const role = String(args[0]);
      const cutoff = Number(args[1]);
      const lastSuccessId = this.loginAttempts
        .filter((a) => a.role === role && a.success === 1 && a.created_at >= cutoff)
        .reduce((max, a) => Math.max(max, a.id), 0);
      const c = this.loginAttempts.filter(
        (a) => a.role === role && a.success === 0 && a.created_at >= cutoff && a.id > lastSuccessId
      ).length;
      return { success: true, results: [{ c } as T] };
    }
    return { success: true, results: [] };
  }
}

class FakeStatement {
  constructor(
    private db: FakeD1,
    private sql: string,
    private args: unknown[] = []
  ) {}

  bind(...args: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, args);
  }

  run() {
    return this.db.doRun(this.sql, this.args);
  }

  first<T = unknown>() {
    return this.db.doFirst<T>(this.sql, this.args);
  }

  all<T = unknown>() {
    return this.db.doAll<T>(this.sql, this.args);
  }
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEnv(mode: string, extra?: Record<string, unknown>): { db: FakeD1; env: Record<string, unknown> } {
  const db = new FakeD1();
  const env: Record<string, unknown> = {
    DB: db,
    ENVIRONMENT: mode,
    ALLOWED_ORIGINS: DEV_ORIGINS.join(","),
    USER_PIN_HASH,
    ADMIN_PASSWORD_HASH,
    ADMIN_EMAIL,
    GEMINI_API_KEY: "",
    WEATHER_API_KEY: "",
    USER_NAME: "Abhi",
    APP_TIMEZONE_OFFSET_MINUTES: "330",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    VAPID_SUBJECT: "",
    CHAT_ROOM: {},
    ...extra,
  };
  return { db, env };
}

function request(path: string, init: RequestInit = {}, env: Record<string, unknown>): Promise<Response> {
  return app.request(path, init, env);
}

function findCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.trimStart().startsWith(`${name}=`));
}

function cookiePair(res: Response, name: string): string | undefined {
  return findCookie(res, name)?.split(";")[0].trim();
}

async function userLogin(env: Record<string, unknown>, origin = PROD_ORIGIN): Promise<Response> {
  return request(
    "/auth/user/login",
    { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ pin: PIN }) },
    env
  );
}

async function adminLogin(env: Record<string, unknown>, origin = PROD_ORIGIN): Promise<Response> {
  return request(
    "/auth/admin/login",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    },
    env
  );
}

// WebSocket upgrade request (GET with the standard handshake headers). Browsers
// always attach the page Origin to these, which is exactly what wsOriginGuard
// validates.
function wsRequest(path: string, headers: Record<string, string>, env: Record<string, unknown>): Promise<Response> {
  return request(
    path,
    {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        ...headers,
      },
    },
    env
  );
}

// Minimal ChatRoom Durable Object namespace double. The /chat/ws route proxies
// the upgrade into it via stub.fetch(url, rawRequest); this records the proxied
// URL (so tests can assert the role param survived) and returns a success
// status. Node cannot construct an actual 101 Response (undici only allows
// 200-599), so 200 stands in for "the DO accepted the handshake" — the real
// ChatRoom DO builds the WebSocketPair and returns 101 itself.
function makeChatRoomMock(): { namespace: Record<string, unknown>; calls: string[] } {
  const calls: string[] = [];
  const namespace = {
    idFromName: () => ({ name: "lovejar-chat" }),
    get: () => ({
      fetch: (url: string) => {
        calls.push(url);
        return new Response(null, { status: 200 });
      },
    }),
  };
  return { namespace, calls };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test("AUTH: user login succeeds with a valid PIN", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await userLogin(env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(cookiePair(res, "lj_session"), "user login must set lj_session");
  assert.equal(cookiePair(res, "lj_admin"), undefined, "user login must not set lj_admin");
});

test("AUTH: admin login succeeds with valid credentials", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await adminLogin(env);
  assert.equal(res.status, 200);
  assert.ok(cookiePair(res, "lj_admin"), "admin login must set lj_admin");
  assert.equal(cookiePair(res, "lj_session"), undefined, "admin login must not set lj_session");
});

test("AUTH: invalid credentials fail", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const badUser = await request(
    "/auth/user/login",
    { method: "POST", headers: { "content-type": "application/json", origin: PROD_ORIGIN }, body: JSON.stringify({ pin: "999999" }) },
    env
  );
  assert.equal(badUser.status, 401);
  const badAdmin = await request(
    "/auth/admin/login",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: PROD_ORIGIN },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong-password" }),
    },
    env
  );
  assert.equal(badAdmin.status, 401);
});

test("AUTH: a user session cannot access admin endpoints", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session");
  const res = await request("/admin/system/configuration", { headers: { origin: PROD_ORIGIN, cookie: userCookie } }, env);
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

test("AUTH: an admin session can access admin endpoints", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await adminLogin(env);
  const adminCookie = cookiePair(login, "lj_admin");
  const res = await request("/admin/system/configuration", { headers: { origin: PROD_ORIGIN, cookie: adminCookie } }, env);
  assert.equal(res.status, 200);
});

test("AUTH: logout revokes the server session and clears both role cookies", async () => {
  await ensureHashes();
  const { env, db } = makeEnv(PROD);
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session");
  const out = await request("/auth/logout", { method: "POST", headers: { origin: PROD_ORIGIN, cookie: userCookie } }, env);
  assert.equal(out.status, 200);
  assert.equal(db.sessions.length, 0, "logout must revoke the session server-side");
  const clearUser = findCookie(out, "lj_session");
  const clearAdmin = findCookie(out, "lj_admin");
  assert.ok(clearUser && clearAdmin, "logout must clear BOTH role cookies");
  assert.match(clearUser, /SameSite=None/);
  assert.match(clearUser, /Secure/);
  assert.match(clearUser, /Expires=Thu, 01 Jan 1970/);
  assert.match(clearAdmin, /SameSite=None/);
  assert.match(clearAdmin, /Secure/);
  const me = await request("/auth/me", { headers: { origin: PROD_ORIGIN, cookie: userCookie } }, env);
  assert.equal((await me.json()).authenticated, false);
});

test("AUTH: expired/revoked session returns 401", async () => {
  await ensureHashes();
  const { env, db } = makeEnv(PROD);
  const now = Math.floor(Date.now() / 1000);
  const expiredToken = "ab".repeat(32);
  db.sessions.push({ token: expiredToken, role: "user", created_at: now - 3600, expires_at: now - 60 });
  const res = await request("/me/home", { headers: { origin: PROD_ORIGIN, cookie: `lj_session=${expiredToken}` } }, env);
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Admin login error handling
// ---------------------------------------------------------------------------

test("ADMIN LOGIN: missing credentials returns 400 with missing_credentials", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({}),
  }, env);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, "missing_credentials");
});

test("ADMIN LOGIN: missing email returns 400 with missing_credentials", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ password: "somepassword" }),
  }, env);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, "missing_credentials");
});

test("ADMIN LOGIN: missing password returns 400 with missing_credentials", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ email: "admin@example.com" }),
  }, env);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, "missing_credentials");
});

test("ADMIN LOGIN: invalid email format returns 400 with invalid_email", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const badEmails = ["notanemail", "missing@tld", "@nodomain.com"];
  for (const badEmail of badEmails) {
    const res = await request("/auth/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: PROD_ORIGIN },
      body: JSON.stringify({ email: badEmail, password: "somepassword" }),
    }, env);
    assert.equal(res.status, 400, `expected 400 for email: ${badEmail}`);
    const body = await res.json();
    assert.equal(body.code, "invalid_email", `expected invalid_email code for: ${badEmail}`);
  }
});

test("ADMIN LOGIN: wrong email returns 401 with invalid_credentials", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ email: "wrong@example.com", password: ADMIN_PASSWORD }),
  }, env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, "invalid_credentials");
});

test("ADMIN LOGIN: wrong password returns 401 with invalid_credentials", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong-password" }),
  }, env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, "invalid_credentials");
});

test("ADMIN LOGIN: wrong email and wrong password produce identical responses", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const wrongEmail = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ email: "wrong@example.com", password: "wrong-password" }),
  }, env);
  const wrongPassword = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong-password" }),
  }, env);
  assert.equal(wrongEmail.status, wrongPassword.status);
  const body1 = await wrongEmail.json();
  const body2 = await wrongPassword.json();
  assert.equal(body1.error, body2.error);
  assert.equal(body1.code, body2.code);
});

test("ADMIN LOGIN: 5th failure triggers rate limit with 429 (post-check)", async () => {
  await ensureHashes();
  const { db, env } = makeEnv(PROD);
  for (let i = 0; i < 4; i++) {
    const res = await request("/auth/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: PROD_ORIGIN },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
    }, env);
    assert.equal(res.status, 401, `attempt ${i + 1} should return 401`);
    const body = await res.json();
    assert.equal(body.code, "invalid_credentials");
  }
  const fifth = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
  }, env);
  assert.equal(db.loginAttempts.length, 5, "expected 5 recorded attempts");
  assert.equal(
    db.loginAttempts.filter((a) => a.role === "admin" && a.success === 0).length,
    5,
    "expected 5 failed admin attempts"
  );

  assert.equal(fifth.status, 429, "5th attempt triggers rate limit via post-check");
  const body = await fifth.json();
  assert.equal(body.code, "rate_limited");
});

test("ADMIN LOGIN: attempt while locked remains 429", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  for (let i = 0; i < 4; i++) {
    await request("/auth/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: PROD_ORIGIN },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
    }, env);
  }
  const fifth = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
  }, env);
  assert.equal(fifth.status, 429, "5th attempt triggers lockout");
  const sixth = await request("/auth/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PROD_ORIGIN },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
  }, env);
  assert.equal(sixth.status, 429);
  const body = await sixth.json();
  assert.equal(body.code, "rate_limited");
});

test("ADMIN LOGIN: successful login resets failure counter", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  for (let i = 0; i < 3; i++) {
    await request("/auth/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: PROD_ORIGIN },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
    }, env);
  }
  const loginRes = await adminLogin(env);
  assert.equal(loginRes.status, 200);
  for (let i = 0; i < 2; i++) {
    const res = await request("/auth/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: PROD_ORIGIN },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
    }, env);
    assert.equal(res.status, 401, `attempt after reset ${i + 1} should return 401, not 429`);
  }
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

test("CORS: production origin is allowed and receives credentials headers", async () => {
  await ensureHashes();
  // ALLOWED_ORIGINS is deliberately left with dev origins to prove it is
  // ignored in production mode.
  const { env } = makeEnv(PROD, { ALLOWED_ORIGINS: "http://localhost:5173" });
  const res = await request("/health", { headers: { origin: PROD_ORIGIN } }, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), PROD_ORIGIN);
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
});

test("CORS: arbitrary origin is rejected for state-changing requests", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await request(
    "/auth/user/login",
    { method: "POST", headers: { "content-type": "application/json", origin: EVIL_ORIGIN }, body: JSON.stringify({ pin: PIN }) },
    env
  );
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("CORS: localhost is not accepted as a production origin", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const post = await request(
    "/auth/user/login",
    { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ pin: PIN }) },
    env
  );
  assert.equal(post.status, 403);
  const get = await request("/health", { headers: { origin: "http://localhost:5173" } }, env);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("access-control-allow-origin"), null);
  assert.equal(get.headers.get("access-control-allow-credentials"), null);
});

test("CORS: credentials are granted only with an explicit allowed origin", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const allowed = await request("/health", { headers: { origin: PROD_ORIGIN } }, env);
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  const disallowed = await request("/health", { headers: { origin: EVIL_ORIGIN } }, env);
  assert.equal(disallowed.headers.get("access-control-allow-origin"), null);
  assert.equal(disallowed.headers.get("access-control-allow-credentials"), null);
  const noOrigin = await request("/health", {}, env);
  assert.equal(noOrigin.headers.get("access-control-allow-credentials"), null);
  assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);
});

test("CORS: OPTIONS preflight from the allowed origin works", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await request(
    "/auth/user/login",
    {
      method: "OPTIONS",
      headers: {
        origin: PROD_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    },
    env
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), PROD_ORIGIN);
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(res.headers.get("access-control-allow-headers") ?? "", /content-type/i);
});

test("CORS: OPTIONS from an arbitrary origin is rejected", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await request(
    "/auth/user/login",
    { method: "OPTIONS", headers: { origin: EVIL_ORIGIN, "access-control-request-method": "POST" } },
    env
  );
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

// ---------------------------------------------------------------------------
// CSRF / origin validation
// ---------------------------------------------------------------------------

test("CSRF: authenticated POST from the allowed Origin succeeds", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session");
  const res = await request(
    "/notifications/read-all",
    { method: "POST", headers: { origin: PROD_ORIGIN, cookie: userCookie, "content-type": "application/json" } },
    env
  );
  assert.equal(res.status, 200);
});

test("CSRF: authenticated state-changing request from a malicious Origin is rejected", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session");
  const res = await request(
    "/notifications/read-all",
    { method: "POST", headers: { origin: EVIL_ORIGIN, cookie: userCookie, "content-type": "application/json" } },
    env
  );
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("CSRF: state-changing request with no Origin is rejected", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session");
  const res = await request(
    "/notifications/read-all",
    { method: "POST", headers: { cookie: userCookie, "content-type": "application/json" } },
    env
  );
  assert.equal(res.status, 403);
});

test("CSRF: lookalike/subdomain/scheme-variant origins are rejected in production", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const badOrigins = [
    "http://lovejar-v2.pages.dev",
    "https://lovejar-v2.pages.dev.evil.example",
    "https://sub.lovejar-v2.pages.dev",
    "https://lovejar-v2.pages.dev/",
    "https://lovejar-v2.pages.dev:8443",
  ];
  for (const origin of badOrigins) {
    const res = await request(
      "/auth/user/login",
      { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ pin: PIN }) },
      env
    );
    assert.equal(res.status, 403, `expected 403 for origin ${origin}`);
  }
});

test("CSRF: GET behavior remains correct", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session");
  // Authenticated GET with no Origin still works (e.g. same-origin / non-browser).
  const meNoOrigin = await request("/auth/me", { headers: { cookie: userCookie } }, env);
  assert.equal(meNoOrigin.status, 200);
  // A cross-site GET from a malicious origin is not blocked server-side (GET is
  // not state-changing), but the payload must never be exposed via CORS.
  const meEvil = await request("/auth/me", { headers: { cookie: userCookie, origin: EVIL_ORIGIN } }, env);
  assert.equal(meEvil.status, 200);
  assert.equal(meEvil.headers.get("access-control-allow-origin"), null);
  // Public health endpoints keep working for uptime monitors (no Origin).
  const health = await request("/health", {}, env);
  assert.equal(health.status, 200);
});

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

test("COOKIE: production session cookie is HttpOnly, Secure, SameSite=None", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await userLogin(env);
  const sc = findCookie(login, "lj_session")!;
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /\bSecure\b/);
  assert.match(sc, /SameSite=None/);
  assert.match(sc, /Path=\//);
});

test("COOKIE: development session cookie keeps SameSite=Strict (local dev unchanged)", async () => {
  await ensureHashes();
  const { env } = makeEnv(DEV);
  const res = await userLogin(env, "http://localhost:5173");
  assert.equal(res.status, 200);
  const sc = findCookie(res, "lj_session")!;
  assert.match(sc, /SameSite=Strict/);
});

test("COOKIE: role cookies remain separate (never merged)", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const u = await userLogin(env);
  assert.ok(cookiePair(u, "lj_session"));
  assert.equal(cookiePair(u, "lj_admin"), undefined);
  const a = await adminLogin(env);
  assert.ok(cookiePair(a, "lj_admin"));
  assert.equal(cookiePair(a, "lj_session"), undefined);
});

test("COOKIE: logout clears both role cookies with attributes matching set", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session");
  const out = await request("/auth/logout", { method: "POST", headers: { origin: PROD_ORIGIN, cookie: userCookie } }, env);
  for (const name of ["lj_session", "lj_admin"]) {
    const cookie = findCookie(out, name)!;
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /\bSecure\b/);
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
  }
});

// ---------------------------------------------------------------------------
// Development mode
// ---------------------------------------------------------------------------

test("DEV: localhost origins keep working for state-changing requests in development mode", async () => {
  await ensureHashes();
  const { env } = makeEnv(DEV);
  for (const origin of DEV_ORIGINS) {
    const res = await userLogin(env, origin);
    assert.equal(res.status, 200, `expected 200 for dev origin ${origin}`);
  }
});

test("DEV: production origin is not accepted in development mode (strict separation)", async () => {
  await ensureHashes();
  const { env } = makeEnv(DEV);
  const res = await userLogin(env, PROD_ORIGIN);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// WebSocket security
// ---------------------------------------------------------------------------

test("WS: valid production Origin succeeds and preserves the user role", async () => {
  await ensureHashes();
  const mock = makeChatRoomMock();
  const { env } = makeEnv(PROD, { CHAT_ROOM: mock.namespace });
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session")!;
  const res = await wsRequest("/chat/ws", { origin: PROD_ORIGIN, cookie: userCookie }, env);
  assert.equal(res.status, 200);
  assert.equal(mock.calls.length, 1);
  assert.equal(new URL(mock.calls[0]).searchParams.get("role"), "user");
});

test("WS: valid production Origin succeeds and preserves the admin role", async () => {
  await ensureHashes();
  const mock = makeChatRoomMock();
  const { env } = makeEnv(PROD, { CHAT_ROOM: mock.namespace });
  const login = await adminLogin(env);
  const adminCookie = cookiePair(login, "lj_admin")!;
  const res = await wsRequest("/chat/ws", { origin: PROD_ORIGIN, cookie: adminCookie }, env);
  assert.equal(res.status, 200);
  assert.equal(mock.calls.length, 1);
  assert.equal(new URL(mock.calls[0]).searchParams.get("role"), "admin");
});

test("WS: malicious production Origins are rejected with 403 and never reach the DO", async () => {
  await ensureHashes();
  const mock = makeChatRoomMock();
  const { env } = makeEnv(PROD, { CHAT_ROOM: mock.namespace });
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session")!;
  const badOrigins = [
    "https://evil.example",
    "https://lovejar-v2.pages.dev.evil.example",
    "http://lovejar-v2.pages.dev",
    "https://lovejar-v2.pages.dev:443",
    "https://lovejar-v2.pages.dev/",
    "https://sub.lovejar-v2.pages.dev",
  ];
  for (const origin of badOrigins) {
    const res = await wsRequest("/chat/ws", { origin, cookie: userCookie }, env);
    assert.equal(res.status, 403, `expected 403 for origin ${origin}`);
  }
  assert.equal(mock.calls.length, 0, "no rejected upgrade may reach the ChatRoom DO");
});

test("WS: null and missing Origin are rejected in production", async () => {
  await ensureHashes();
  const mock = makeChatRoomMock();
  const { env } = makeEnv(PROD, { CHAT_ROOM: mock.namespace });
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session")!;
  const nullOrigin = await wsRequest("/chat/ws", { origin: "null", cookie: userCookie }, env);
  assert.equal(nullOrigin.status, 403);
  const missingOrigin = await wsRequest("/chat/ws", { cookie: userCookie }, env);
  assert.equal(missingOrigin.status, 403);
  assert.equal(mock.calls.length, 0);
});

test("WS: origin check runs before session auth (no session-presence oracle)", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  // No cookie at all: a disallowed origin gets the same 403 as any other
  // disallowed-origin request, never a 401 that would confirm session validity.
  const res = await wsRequest("/chat/ws", { origin: "https://evil.example" }, env);
  assert.equal(res.status, 403);
});

test("WS: configured localhost Origins succeed in development mode", async () => {
  await ensureHashes();
  const mock = makeChatRoomMock();
  const { env } = makeEnv(DEV, { CHAT_ROOM: mock.namespace });
  for (const origin of DEV_ORIGINS) {
    const login = await userLogin(env, origin);
    const userCookie = cookiePair(login, "lj_session")!;
    const res = await wsRequest("/chat/ws", { origin, cookie: userCookie }, env);
    assert.equal(res.status, 200, `expected 200 for dev origin ${origin}`);
  }
});

test("WS: arbitrary origin is rejected in development mode", async () => {
  await ensureHashes();
  const { env } = makeEnv(DEV);
  const login = await userLogin(env, "http://localhost:5173");
  const userCookie = cookiePair(login, "lj_session")!;
  const res = await wsRequest("/chat/ws", { origin: "https://evil.example", cookie: userCookie }, env);
  assert.equal(res.status, 403);
});

test("WS: invalid session still rejected on the upgrade path", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const res = await wsRequest("/chat/ws", { origin: PROD_ORIGIN, cookie: "lj_session=" + "ab".repeat(32) }, env);
  assert.equal(res.status, 401);
});

test("WS: revoked session still rejected on the upgrade path", async () => {
  await ensureHashes();
  const { env } = makeEnv(PROD);
  const login = await userLogin(env);
  const userCookie = cookiePair(login, "lj_session")!;
  const out = await request("/auth/logout", { method: "POST", headers: { origin: PROD_ORIGIN, cookie: userCookie } }, env);
  assert.equal(out.status, 200);
  const res = await wsRequest("/chat/ws", { origin: PROD_ORIGIN, cookie: userCookie }, env);
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Security policy helpers
// ---------------------------------------------------------------------------

test("SECURITY: production allowlist ignores dev ALLOWED_ORIGINS", () => {
  assert.equal(isProduction({ ENVIRONMENT: "production" }), true);
  assert.equal(isProduction({ ENVIRONMENT: "development" }), false);
  assert.equal(isProduction({}), false);
  assert.deepEqual(allowedOrigins({ ENVIRONMENT: "production", ALLOWED_ORIGINS: "http://localhost:5173" }), [
    PROD_ORIGIN,
  ]);
  assert.equal(originAllowed({ ENVIRONMENT: "production", ALLOWED_ORIGINS: "http://localhost:5173" }, "http://localhost:5173"), false);
  assert.equal(originAllowed({ ENVIRONMENT: "production" }, PROD_ORIGIN), true);
});
