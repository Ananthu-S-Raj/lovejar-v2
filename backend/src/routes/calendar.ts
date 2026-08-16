import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { istDateString, daysBetween } from "../lib/time";
import { LIMITS } from "../lib/limits";
import { notify } from "../lib/notifications";

const calendar = new Hono<AppEnv>();
calendar.use("*", requireAuth());

calendar.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, description, event_date, event_time, created_by, created_at FROM calendar_events ORDER BY event_date ASC"
  ).all<{ event_date: string }>();

  const today = istDateString();
  const events = rows.results ?? [];
  // Upcoming = within next 7 days, used by the frontend to show an in-app notification
  // banner when the app is opened (per "notifications only when app is opened").
  const upcoming = events.filter((e) => {
    const diff = daysBetween(today, e.event_date);
    return diff >= 0 && diff <= 7;
  });

  return c.json({ events, upcoming });
});

calendar.post("/", async (c) => {
  const { title, description, eventDate, eventTime } = await c.req.json<{
    title?: string;
    description?: string;
    eventDate?: string;
    eventTime?: string;
  }>();
  if (!title || !eventDate) return c.json({ error: "Title and eventDate required" }, 400);
  if (title.length > LIMITS.CALENDAR_TITLE) {
    return c.json({ error: `Title must be ${LIMITS.CALENDAR_TITLE} characters or fewer` }, 400);
  }
  if (description !== undefined && description !== null && description.length > LIMITS.CALENDAR_DESCRIPTION) {
    return c.json({ error: `Description must be ${LIMITS.CALENDAR_DESCRIPTION} characters or fewer` }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const result = await c.env.DB.prepare(
    "INSERT INTO calendar_events (title, description, event_date, event_time, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(title, description ?? null, eventDate, eventTime ?? null, c.get("role"), now)
    .run();
  const actor = c.get("role");
  const other: "user" | "admin" = actor === "user" ? "admin" : "user";
  const when = eventTime ? `${eventDate} at ${eventTime}` : eventDate;
  await notify(c.env, other, "calendar", `New event: ${title}`, when, Number(result.meta.last_row_id));
  return c.json({ id: result.meta.last_row_id, ok: true });
});

calendar.patch("/:id", async (c) => {
  const { title, description, eventDate, eventTime } = await c.req.json<{
    title?: string;
    description?: string;
    eventDate?: string;
    eventTime?: string;
  }>();
  if (title !== undefined && title.length > LIMITS.CALENDAR_TITLE) {
    return c.json({ error: `Title must be ${LIMITS.CALENDAR_TITLE} characters or fewer` }, 400);
  }
  if (description !== undefined && description !== null && description.length > LIMITS.CALENDAR_DESCRIPTION) {
    return c.json({ error: `Description must be ${LIMITS.CALENDAR_DESCRIPTION} characters or fewer` }, 400);
  }
  await c.env.DB.prepare(
    "UPDATE calendar_events SET title = COALESCE(?, title), description = COALESCE(?, description), " +
      "event_date = COALESCE(?, event_date), event_time = COALESCE(?, event_time) WHERE id = ?"
  )
    .bind(title ?? null, description ?? null, eventDate ?? null, eventTime ?? null, c.req.param("id"))
    .run();
  const row = await c.env.DB.prepare("SELECT title FROM calendar_events WHERE id = ?").bind(c.req.param("id")).first<{ title: string }>();
  const actor = c.get("role");
  const other: "user" | "admin" = actor === "user" ? "admin" : "user";
  await notify(c.env, other, "calendar", `Event updated: ${row?.title ?? "an event"}`, eventDate ? `New date: ${eventDate}` : "Details updated", Number(c.req.param("id")));
  return c.json({ ok: true });
});

calendar.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM calendar_events WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default calendar;
