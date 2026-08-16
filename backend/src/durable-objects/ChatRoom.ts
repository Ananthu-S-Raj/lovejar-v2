import type { AppEnv } from "../types";
import { LIMITS } from "../lib/limits";
import { notify } from "../lib/notifications";

type ClientInfo = {
  ws: WebSocket;
  role: "user" | "admin";
};

type IncomingMessage =
  | { type: "message"; body: string; kind?: "text" | "hug" | "kiss" }
  | { type: "typing"; isTyping: boolean }
  | { type: "delete"; id: number; forEveryone: boolean }
  | { type: "clear_history" }
  | { type: "ping" };

// Canonical display copy for affection messages. Generated server-side so both
// sides always see the same text regardless of client version.
const AFFECTION_BODY: Record<"hug" | "kiss", string> = {
  hug: "🤗 A big hug, sent with love",
  kiss: "💋 Muah! 💕",
};

// One durable object instance (id "lovejar-chat") backs the whole chat feature,
// since there are only ever two participants.
export class ChatRoom {
  state: DurableObjectState;
  env: AppEnv["Bindings"];
  clients: Map<WebSocket, ClientInfo> = new Map();
  // Last time each client was heard from (any frame). Drives the stale-presence
  // watchdog in alarm(): a client that silently died (no close frame — dropped
  // network, phone asleep, DO restarted) is evicted so presence stays honest.
  lastSeen: Map<WebSocket, number> = new Map();
  // Application-level presence: last app heartbeat per role. Presence is the
  // app being OPEN (any page), not the chat page being open, so the app shell
  // heartbeats this endpoint on a timer. The watchdog expires a role when its
  // heartbeat is stale, and `online` is (heartbeat fresh) OR (live WS client).
  appSeen: { user: number; admin: number } = { user: 0, admin: 0 };
  // Clients who never answered a ping are considered stale and removed.
  readonly HEARTBEAT_TIMEOUT_MS = 45_000;
  // A role whose app heartbeat is older than this is considered offline.
  readonly APP_PRESENCE_TIMEOUT_MS = 45_000;
  readonly WATCHDOG_INTERVAL_MS = 30_000;

  constructor(state: DurableObjectState, env: AppEnv["Bindings"]) {
    this.state = state;
    this.env = env;
  }

  async ensureWatchdog(): Promise<void> {
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + this.WATCHDOG_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const [ws, seen] of this.lastSeen) {
      if (now - seen > this.HEARTBEAT_TIMEOUT_MS) {
        try {
          this.clients.delete(ws);
          this.lastSeen.delete(ws);
          ws.close(4001, "heartbeat timeout");
        } catch {
          // already closed
        }
      }
    }
    // Expire stale app-level presence the same way.
    if (now - this.appSeen.user > this.APP_PRESENCE_TIMEOUT_MS) this.appSeen.user = 0;
    if (now - this.appSeen.admin > this.APP_PRESENCE_TIMEOUT_MS) this.appSeen.admin = 0;
    const appActive = this.appSeen.user > 0 || this.appSeen.admin > 0;
    if (this.clients.size === 0 && !appActive) {
      await this.state.storage.deleteAlarm();
    } else {
      this.broadcastPresence();
      await this.state.storage.setAlarm(Date.now() + this.WATCHDOG_INTERVAL_MS);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/notify") {
      // Internal call from the auth route to push a failed-login alert to the admin.
      const payload = await request.json<{ type: string; message: string }>();
      this.broadcast(JSON.stringify({ type: "admin_alert", alertType: payload.type, message: payload.message }));
      return new Response("ok");
    }

    if (url.pathname === "/app-presence") {
      // Application-level presence heartbeat, called by the app shell (any page),
      // NOT just the chat page. Records when the role's app was last open.
      const { role } = await request.json<{ role?: "user" | "admin" }>();
      if (role !== "user" && role !== "admin") {
        return new Response("Missing role", { status: 400 });
      }
      this.appSeen[role] = Date.now();
      await this.ensureWatchdog();
      this.broadcastPresence();
      return new Response(JSON.stringify({ ok: true }));
    }

    if (url.pathname === "/ws") {
      const role = url.searchParams.get("role");
      if (role !== "user" && role !== "admin") {
        return new Response("Missing role", { status: 400 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      await this.handleSession(server, role);
      return new Response(null, { status: 101, webSocket: client });
    }

    // --- Admin support endpoints (internal plumbing) -------------------------
    // These are reached only through the route layer, which enforces
    // `requireAuth("admin")`. Same trust model as /ws (role set by the route).

    if (url.pathname === "/status") {
      return new Response(JSON.stringify({ online: this.presenceOnline() }));
    }

    if (url.pathname === "/affection") {
      const { kind } = await request.json<{ kind?: string }>();
      if (kind !== "hug" && kind !== "kiss") {
        return new Response(JSON.stringify({ error: "kind must be hug or kiss" }), { status: 400 });
      }
      return await this.createAffection(kind);
    }

    if (url.pathname === "/delete") {
      const { id } = await request.json<{ id?: number }>();
      if (!Number.isInteger(id) || (id as number) <= 0) {
        return new Response(JSON.stringify({ error: "id required" }), { status: 400 });
      }
      const result = await this.deleteMessage(id as number, true, "admin");
      return new Response(JSON.stringify({ ok: true, deleted: result }));
    }

    if (url.pathname === "/clear-everyone") {
      await this.clearEveryone();
      return new Response(JSON.stringify({ ok: true }));
    }

    return new Response("Not found", { status: 404 });
  }

  async createAffection(kind: "hug" | "kiss"): Promise<Response> {
    const now = Math.floor(Date.now() / 1000);
    const body = AFFECTION_BODY[kind];
    const adminName = await this.resolveDisplayName("admin");
    const result = await this.env.DB
      .prepare("INSERT INTO chat_messages (sender, body, kind, created_at) VALUES ('admin', ?, ?, ?)")
      .bind(body, kind, now)
      .run();
    this.broadcast(
      JSON.stringify({
        type: "message",
        id: result.meta.last_row_id,
        sender: "admin",
        body,
        kind,
        createdAt: now,
      })
    );
    await notify(this.env, "user", kind, `A ${kind} from ${adminName}`, body, Number(result.meta.last_row_id));
    return new Response(JSON.stringify({ ok: true }));
  }

  async deleteMessage(id: number, forEveryone: boolean, actorRole: "user" | "admin"): Promise<boolean> {
    const row = await this.env.DB
      .prepare("SELECT sender FROM chat_messages WHERE id = ?")
      .bind(id)
      .first<{ sender: "user" | "admin" }>();
    if (!row) return false;
    // Authorization rule: only the sender may delete a message — either for
    // everyone or just from their own view. This keeps the rule uniform and
    // prevents a crafted frame from either side hiding or removing the other's
    // messages.
    if (row.sender !== actorRole) return false;
    if (forEveryone) {
      await this.env.DB.prepare("UPDATE chat_messages SET deleted_for_everyone = 1 WHERE id = ?").bind(id).run();
      this.broadcast(JSON.stringify({ type: "delete", id, forEveryone: true, by: actorRole }));
    } else {
      const col = actorRole === "user" ? "deleted_for_user" : "deleted_for_admin";
      await this.env.DB.prepare(`UPDATE chat_messages SET ${col} = 1 WHERE id = ?`).bind(id).run();
      this.broadcast(JSON.stringify({ type: "delete", id, forEveryone: false, by: actorRole }));
    }
    return true;
  }

  async clearEveryone(): Promise<void> {
    await this.env.DB.prepare("UPDATE chat_messages SET deleted_for_everyone = 1").run();
    this.broadcast(JSON.stringify({ type: "history_cleared", by: "admin", forEveryone: true }));
  }

  async handleSession(ws: WebSocket, role: "user" | "admin") {
    // @ts-ignore accept() exists on the Workers runtime WebSocket
    ws.accept();
    this.clients.set(ws, { ws, role });
    this.lastSeen.set(ws, Date.now());
    await this.ensureWatchdog();
    this.broadcastPresence();

    ws.addEventListener("message", async (event: MessageEvent) => {
      try {
        const data: IncomingMessage = JSON.parse(event.data as string);
        // Any frame — a ping, typing, or a real message — proves the client is
        // alive and resets its heartbeat deadline.
        this.lastSeen.set(ws, Date.now());
        await this.handleIncoming(role, data);
      } catch {
        // ignore malformed frames
      }
    });

    const cleanup = () => {
      this.clients.delete(ws);
      this.lastSeen.delete(ws);
      this.broadcastPresence();
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }

  async handleIncoming(role: "user" | "admin", data: IncomingMessage) {
    const db = this.env.DB;

    if (data.type === "message") {
      // Hugs and kisses are separate interaction types; the body is set
      // server-side so the stored copy is always canonical.
      const kind: "text" | "hug" | "kiss" =
        data.kind === "hug" || data.kind === "kiss" ? data.kind : "text";
      const body = kind === "text" ? data.body?.trim() : AFFECTION_BODY[kind];
      if (!body) return;
      if (kind === "text" && body.length > LIMITS.CHAT_MESSAGE) {
        this.sendToRole(
          role,
          JSON.stringify({ type: "error", message: `Message must be ${LIMITS.CHAT_MESSAGE} characters or fewer` })
        );
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const result = await db
        .prepare("INSERT INTO chat_messages (sender, body, kind, created_at) VALUES (?, ?, ?, ?)")
        .bind(role, body, kind, now)
        .run();
      this.broadcast(
        JSON.stringify({
          type: "message",
          id: result.meta.last_row_id,
          sender: role,
          body,
          kind,
          createdAt: now,
        })
      );
      // Exactly one notification per live message, created here at insert time
      // (never on history load, never client-side) so nothing can duplicate it.
      // The recipient is the peer; the sender never receives their own.
      const peer: "user" | "admin" = role === "user" ? "admin" : "user";
      const senderName = await this.resolveDisplayName(role);
      if (kind === "hug") {
        await notify(this.env, peer, "hug", `A hug from ${senderName}`, "A big hug, sent with love 🤗", Number(result.meta.last_row_id));
      } else if (kind === "kiss") {
        await notify(this.env, peer, "kiss", `A kiss from ${senderName}`, "Muah! 💋", Number(result.meta.last_row_id));
      } else {
        await notify(
          this.env,
          peer,
          "chat",
          `New message from ${senderName}`,
          `${senderName}: ${body.length > 140 ? body.slice(0, 140) + "…" : body}`,
          Number(result.meta.last_row_id)
        );
      }
      return;
    }

    if (data.type === "typing") {
      this.broadcast(JSON.stringify({ type: "typing", sender: role, isTyping: data.isTyping }), role);
      return;
    }

    if (data.type === "delete") {
      const ok = await this.deleteMessage(data.id, !!data.forEveryone, role);
      // Explicit ack/error so the deleter gets toast feedback instead of a
      // silent no-op (the peer still receives the broadcast normally).
      this.sendToRole(
        role,
        ok
          ? JSON.stringify({ type: "delete_result", ok: true, id: data.id, forEveryone: !!data.forEveryone })
          : JSON.stringify({ type: "error", message: "Only the sender can delete that message." })
      );
      return;
    }

    if (data.type === "clear_history") {
      const col = role === "user" ? "deleted_for_user" : "deleted_for_admin";
      await db.prepare(`UPDATE chat_messages SET ${col} = 1`).run();
      // Broadcast to everyone (not just the peer): each client clears exactly
      // its own side when by === its own role. A per-side clear must never
      // wipe the other person's view, and the clearer's own list must clear
      // immediately instead of waiting for a reload.
      this.broadcast(JSON.stringify({ type: "history_cleared", by: role, forEveryone: false }));
      // Ack so the clearer gets a toast instead of a silent no-op.
      this.sendToRole(role, JSON.stringify({ type: "clear_result", ok: true }));
      return;
    }

    if (data.type === "ping") {
      this.sendToRole(role, JSON.stringify({ type: "pong" }));
      return;
    }
  }

  // A role is online when its app heartbeat is fresh (the app is open on any
  // page) or it has a live chat WebSocket. Heartbeat-fresh wins on its own, so
  // leaving the chat page doesn't flip someone offline mid-use.
  private presenceOnline(): { user: boolean; admin: boolean } {
    const now = Date.now();
    const online = { user: false, admin: false };
    for (const info of this.clients.values()) online[info.role] = true;
    if (now - this.appSeen.user <= this.APP_PRESENCE_TIMEOUT_MS) online.user = true;
    if (now - this.appSeen.admin <= this.APP_PRESENCE_TIMEOUT_MS) online.admin = true;
    return online;
  }

  broadcastPresence() {
    this.broadcast(JSON.stringify({ type: "presence", online: this.presenceOnline() }));
  }

  // The display name a role appears as in notifications: its configured
  // nickname (if any) else the server-side default. Keeps chat, popups and the
  // notification center using the same names the /chat/names read returns.
  async resolveDisplayName(role: "user" | "admin"): Promise<string> {
    const row = await this.env.DB
      .prepare("SELECT nickname FROM nicknames WHERE role = ?")
      .bind(role)
      .first<{ nickname: string }>();
    return row?.nickname ?? (role === "user" ? this.env.USER_NAME : "Admin");
  }

  sendToRole(role: "user" | "admin", payload: string) {
    for (const info of this.clients.values()) {
      if (info.role !== role) continue;
      try {
        info.ws.send(payload);
      } catch {
        this.clients.delete(info.ws);
      }
    }
  }

  broadcast(payload: string, exceptRole?: "user" | "admin") {
    for (const info of this.clients.values()) {
      if (exceptRole && info.role === exceptRole) continue;
      try {
        info.ws.send(payload);
      } catch {
        this.clients.delete(info.ws);
      }
    }
  }
}
