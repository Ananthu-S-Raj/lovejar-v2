import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";
import { LIMITS } from "../lib/limits";
import { notify } from "../lib/notifications";

const bucketlist = new Hono<AppEnv>();
bucketlist.use("*", requireAuth());

bucketlist.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, description, completed, completed_at, created_by, created_at FROM bucket_list ORDER BY completed ASC, created_at DESC"
  ).all();
  return c.json({ items: rows.results ?? [] });
});

bucketlist.post("/", async (c) => {
  const { title, description } = await c.req.json<{ title?: string; description?: string }>();
  if (!title) return c.json({ error: "Title required" }, 400);
  if (title.length > LIMITS.BUCKET_TITLE) {
    return c.json({ error: `Title must be ${LIMITS.BUCKET_TITLE} characters or fewer` }, 400);
  }
  if (description !== undefined && description !== null && description.length > LIMITS.BUCKET_DESCRIPTION) {
    return c.json({ error: `Description must be ${LIMITS.BUCKET_DESCRIPTION} characters or fewer` }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const result = await c.env.DB.prepare(
    "INSERT INTO bucket_list (title, description, created_by, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(title, description ?? null, c.get("role"), now)
    .run();
  if (c.get("role") === "user") {
    await notify(c.env, "admin", "bucket", "Bucket list updated", `${c.env.USER_NAME} added: ${title}`, Number(result.meta.last_row_id));
  }
  return c.json({ id: result.meta.last_row_id, ok: true });
});

bucketlist.patch("/:id", async (c) => {
  const { title, description, completed } = await c.req.json<{
    title?: string;
    description?: string;
    completed?: boolean;
  }>();
  const id = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);

  if (title !== undefined && title.length > LIMITS.BUCKET_TITLE) {
    return c.json({ error: `Title must be ${LIMITS.BUCKET_TITLE} characters or fewer` }, 400);
  }
  if (description !== undefined && description !== null && description.length > LIMITS.BUCKET_DESCRIPTION) {
    return c.json({ error: `Description must be ${LIMITS.BUCKET_DESCRIPTION} characters or fewer` }, 400);
  }

  if (completed !== undefined) {
    await c.env.DB.prepare("UPDATE bucket_list SET completed = ?, completed_at = ? WHERE id = ?")
      .bind(completed ? 1 : 0, completed ? now : null, id)
      .run();
    if (completed && c.get("role") === "user") {
      const row = await c.env.DB.prepare("SELECT title FROM bucket_list WHERE id = ?").bind(id).first<{ title: string }>();
      await notify(c.env, "admin", "bucket", "Bucket list updated", `${c.env.USER_NAME} checked off "${row?.title ?? "an item"}" ✨`, Number(id));
    }
  }
  if (title !== undefined || description !== undefined) {
    await c.env.DB.prepare(
      "UPDATE bucket_list SET title = COALESCE(?, title), description = COALESCE(?, description) WHERE id = ?"
    )
      .bind(title ?? null, description ?? null, id)
      .run();
  }
  return c.json({ ok: true });
});

bucketlist.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM bucket_list WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default bucketlist;
