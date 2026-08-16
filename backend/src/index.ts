import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./types";

import authRoutes from "./routes/auth";
import jarRoutes from "./routes/jar";
import streakRoutes from "./routes/streak";
import chatRoutes from "./routes/chat";
import lettersRoutes from "./routes/letters";
import bucketlistRoutes from "./routes/bucketlist";
import calendarRoutes from "./routes/calendar";
import petRoutes from "./routes/pet";
import weatherRoutes from "./routes/weather";
import gameRoutes from "./routes/game";
import adminRoutes from "./routes/admin";
import notificationsRoutes from "./routes/notifications";
import pushRoutes from "./routes/push";
import healthRoutes from "./routes/health";

import { greeting, isBirthdayToday } from "./lib/time";
import { requireAuth } from "./lib/middleware";

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    // Explicit allowlist only. ALLOWED_ORIGINS is a comma-separated list of
    // frontend origins (see wrangler.toml [vars]). Never reflects arbitrary origins.
    origin: (origin, c) => {
      if (!origin) return null; // same-origin / non-browser requests need no CORS headers
      const allowed = (c.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
  })
);

// Security headers on every response (defense in depth; the browser-enforced
// document policies live in the frontend hosting config).
app.use("*", async (c, next) => {
  await next();
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=(), usb=()");
});

app.get("/", (c) => c.json({ name: "LoveJar API", status: "ok" }));

app.get("/me/home", requireAuth(), async (c) => {
  const role = c.get("role");
  const displayName = role === "admin" ? "Admin" : c.env.USER_NAME;
  return c.json({
    role,
    name: displayName,
    greeting: greeting(displayName),
    isBirthday: isBirthdayToday(),
  });
});

app.route("/auth", authRoutes);
app.route("/jar", jarRoutes);
app.route("/streak", streakRoutes);
app.route("/chat", chatRoutes);
app.route("/letters", lettersRoutes);
app.route("/bucket-list", bucketlistRoutes);
app.route("/calendar", calendarRoutes);
app.route("/pet", petRoutes);
app.route("/weather", weatherRoutes);
app.route("/game", gameRoutes);
app.route("/admin", adminRoutes);
app.route("/notifications", notificationsRoutes);
app.route("/push", pushRoutes);
app.route("/", healthRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  // Malformed / empty JSON bodies surface as SyntaxError from c.req.json().
  // Return a client error instead of a 500 and avoid leaking parser details.
  if (err instanceof SyntaxError) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
export { ChatRoom } from "./durable-objects/ChatRoom";
