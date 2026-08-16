import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { getSession, parseCookie, ADMIN_COOKIE, USER_COOKIE } from "./auth-utils";

export function requireAuth(role?: "user" | "admin"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const cookieHeader = c.req.header("cookie") ?? null;
    // Each role owns a dedicated cookie (lj_admin / lj_session), so a login of
    // the other role on the same browser can't invalidate this session.
    const token =
      role === "admin"
        ? parseCookie(cookieHeader, ADMIN_COOKIE)
        : role === "user"
          ? parseCookie(cookieHeader, USER_COOKIE)
          : parseCookie(cookieHeader, ADMIN_COOKIE) ?? parseCookie(cookieHeader, USER_COOKIE);
    const session = await getSession(c.env.DB, token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (role && session.role !== role) {
      return c.json({ error: "Forbidden" }, 403);
    }
    c.set("role", session.role);
    c.set("token", token ?? "");
    await next();
  };
}
