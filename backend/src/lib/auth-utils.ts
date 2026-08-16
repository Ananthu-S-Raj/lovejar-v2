// PBKDF2-based password/PIN hashing and session token helpers using Web Crypto,
// which is available natively in the Workers runtime (no external deps needed).

const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function hashSecret(secret: string, saltHex?: string): Promise<string> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `${toHex(salt.buffer as ArrayBuffer)}:${toHex(bits)}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [saltHex] = stored.split(":");
  if (!saltHex) return false;
  const recomputed = await hashSecret(secret, saltHex);
  // constant-time-ish compare
  if (recomputed.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < recomputed.length; i++) {
    diff |= recomputed.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}

export function newToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer);
}

export type Role = "user" | "admin";

export async function createSession(db: D1Database, role: Role): Promise<{ token: string; expiresAt: number }> {
  const token = newToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 60 * 24 * 14; // 14 days
  await db
    .prepare("INSERT INTO sessions (token, role, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, role, now, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function getSession(db: D1Database, token: string | undefined | null) {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare("SELECT token, role, expires_at FROM sessions WHERE token = ?")
    .bind(token)
    .first<{ token: string; role: Role; expires_at: number }>();
  if (!row || row.expires_at < now) return null;
  return row;
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

// Session cookies are per-role so a user login in the same browser can never
// clobber the admin session (and vice versa). Both apps share one API origin
// (localhost:8787), so a single shared cookie name would let the last login of
// either role overwrite the other role's token, turning legitimate admin calls
// into 403 "Forbidden" while the session is actually fine.
export const USER_COOKIE = "lj_session";
export const ADMIN_COOKIE = "lj_admin";

export function sessionCookie(token: string, expiresAt: number, name = USER_COOKIE): string {
  const expires = new Date(expiresAt * 1000).toUTCString();
  return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`;
}

export function clearSessionCookie(name = USER_COOKIE): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// ---------------------------------------------------------------------------
// app_settings (key/value) helpers — shared by auth and admin routes.

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch()) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
    .bind(key, value)
    .run();
}

// ---------------------------------------------------------------------------
// Runtime credential overrides.
//
// PIN / password hashes can be set live by the admin and are stored in D1
// (app_settings: user_pin_hash / admin_password_hash). A D1 override is the
// active credential; when none exists the app falls back to the Worker secret
// (USER_PIN_HASH / ADMIN_PASSWORD_HASH) which bootstraps the account on first
// deploy. Recovery = delete the D1 override (`wrangler d1 execute ...`) to go
// back to the Worker secret.

export async function activeCredentialHash(
  db: D1Database,
  key: "user_pin_hash" | "admin_password_hash",
  fallback: string
): Promise<string> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

// ---------------------------------------------------------------------------
// Session revocation on credential change: changing a PIN/password must
// invalidate existing sessions so the old credential can't keep you logged in.

export async function revokeRoleSessions(db: D1Database, role: Role) {
  await db.prepare("DELETE FROM sessions WHERE role = ?").bind(role).run();
}

export async function revokeAdminSessionsExcept(db: D1Database, exceptToken: string) {
  await db.prepare("DELETE FROM sessions WHERE role = 'admin' AND token != ?").bind(exceptToken).run();
}
