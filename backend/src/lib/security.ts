import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

// ---------------------------------------------------------------------------
// Cross-origin security policy (CORS + CSRF/origin guard).
//
// Production topology: the frontend (https://lovejar-v2.pages.dev) and the
// backend (https://lovejar-backend.ananthusraj70.workers.dev) are on different
// sites. That means (a) session cookies must be SameSite=None so the browser
// will attach them cross-site (see cookiePolicy in auth-utils), and (b) CORS
// is NOT CSRF protection — a SameSite=None cookie is also sent on cross-site
// requests that carry it, so every state-changing request must additionally
// prove its Origin is the real frontend.
//
// Local development (http://localhost:5173 / http://127.0.0.1:5173 /
// http://localhost:5174 against http://localhost:8787) is same-site plain-HTTP
// and keeps its own allowlist.
//
// The mode is driven by the ENVIRONMENT binding:
//   "production"  -> ONLY https://lovejar-v2.pages.dev is accepted, and the
//                    dev ALLOWED_ORIGINS list is ignored entirely so localhost
//                    can never become a production origin.
//   anything else -> the dev ALLOWED_ORIGINS list (see wrangler.toml [vars]).
//
// The two modes never mix.
// ---------------------------------------------------------------------------

export const PRODUCTION_ALLOWED_ORIGINS = ["https://lovejar-v2.pages.dev"] as const;

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isProduction(env: { ENVIRONMENT?: string }): boolean {
  return env.ENVIRONMENT === "production";
}

export function allowedOrigins(env: { ENVIRONMENT?: string; ALLOWED_ORIGINS?: string }): string[] {
  if (isProduction(env)) return [...PRODUCTION_ALLOWED_ORIGINS];
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Exact string equality only: an Origin either matches an allowed origin byte
// for byte or it does not. This inherently rejects scheme variants
// (http://), trailing slashes, subdomains and lookalike domains such as
// https://lovejar-v2.pages.dev.evil.example.
export function originAllowed(
  env: { ENVIRONMENT?: string; ALLOWED_ORIGINS?: string },
  origin: string | null | undefined
): boolean {
  return !!origin && allowedOrigins(env).includes(origin);
}

// Single middleware implementing BOTH the CORS policy and the CSRF/origin
// guard so the two can never drift apart:
//
//   - Allowed origins get Access-Control-Allow-Origin + Allow-Credentials.
//   - Disallowed/missing origins get neither, so credentials are only ever
//     granted alongside an explicitly allowed origin.
//   - OPTIONS preflights from allowed origins get the standard preflight
//     headers; anything else is rejected with 403.
//   - State-changing requests (POST/PUT/PATCH/DELETE) must carry an allowed
//     Origin. Browsers always send an Origin header on cross-site state
//     changes, so a missing or invalid Origin is either a CSRF attempt or a
//     non-browser client — both are rejected before any mutation runs.
//   - GET/HEAD and everything else is intentionally NOT origin-gated so
//     health checks, uptime monitors and other read-only probes keep working.
//     Cross-site reads remain safe because the response is only readable to an
//     allowed origin (CORS); a disallowed origin never receives the payload.
export const corsAndOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("origin") ?? null;
  const allowed = originAllowed(c.env, origin);

  // Cache-correctness: the response varies on the Origin regardless of whether
  // it is allowed, so every response must advertise that.
  c.header("Vary", "Origin", { append: true });

  if (allowed && origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
  }

  if (c.req.method === "OPTIONS") {
    if (!allowed) {
      return c.json({ error: "Origin not allowed" }, 403);
    }
    c.header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    const requestedHeaders = c.req.header("Access-Control-Request-Headers");
    if (requestedHeaders) {
      c.header("Access-Control-Allow-Headers", requestedHeaders);
      c.header("Vary", "Access-Control-Request-Headers", { append: true });
    }
    c.header("Access-Control-Max-Age", "86400");
    return c.body(null, 204);
  }

  if (STATE_CHANGING_METHODS.has(c.req.method) && !allowed) {
    return c.json({ error: "Origin not allowed" }, 403);
  }

  await next();
};

// WebSocket upgrade guard.
//
// A browser WebSocket handshake is a GET with the page's Origin attached, so a
// missing/null/disallowed Origin on the upgrade path is either a non-browser
// client or a cross-site forgery — reject it with a generic 403 before the
// request can be proxied into the ChatRoom Durable Object. This reuses the
// exact same mode-aware allowlist as corsAndOriginGuard (no second list to
// keep in sync): production accepts only https://lovejar-v2.pages.dev,
// development accepts the localhost ALLOWED_ORIGINS list.
//
// It is registered in chat.ts BEFORE session auth so that a disallowed origin
// is rejected outright (403) without a session/D1 lookup and without leaking
// whether a valid session exists. Authenticated requests then continue through
// the unchanged requireAuth middleware.
export const wsOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!originAllowed(c.env, c.req.header("origin"))) {
    return c.json({ error: "Origin not allowed" }, 403);
  }
  await next();
};
