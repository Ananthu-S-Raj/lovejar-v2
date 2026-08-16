import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import AdminCard from "../../components/admin/AdminCard";
import StatusPill from "../../components/admin/StatusPill";
import FormStatus from "../../components/admin/FormStatus";
import SectionTabs from "../../components/admin/SectionTabs";
import { useConfirm } from "../../components/admin/ConfirmDialog";
import { useToast } from "../../components/ToastProvider";
import { timeAgo } from "./utils";
import type { DashboardChat, NotificationItem } from "./types";

type Tab = "Chat" | "Notifications" | "Push";

const NOTIFICATION_TYPES = ["chat", "hug", "kiss", "jar", "streak", "letter", "bucket", "calendar", "pet", "game", "security"];

export default function AdminCommunication() {
  const [tab, setTab] = useState<Tab>("Chat");
  return (
    <div className="page admin-page">
      <h2 className="admin-title">Communication</h2>
      <p className="admin-subtitle">How the two of you reach each other — chat, notifications and browser push.</p>
      <SectionTabs tabs={["Chat", "Notifications", "Push"]} active={tab} onChange={(t) => setTab(t as Tab)} />
      {tab === "Chat" && <ChatTab />}
      {tab === "Notifications" && <NotificationsTab />}
      {tab === "Push" && <PushTab />}
    </div>
  );
}

function ChatTab() {
  const [chat, setChat] = useState<DashboardChat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ask, dialog } = useConfirm();
  const toast = useToast();

  function load() {
    setError(null);
    api.get<{ chat: DashboardChat }>("/admin/dashboard").then((r) => setChat(r.chat)).catch(() => setError("Couldn't load chat."));
  }
  useEffect(load, []);

  async function clearChat() {
    const ok = await ask({
      title: "Clear the whole chat?",
      message: "Every message is hidden for both of you, permanently. This can't be undone.",
      confirmLabel: "Clear chat",
    });
    if (!ok) return;
    setBusy(true);
    setStatus(null);
    try {
      await api.post("/chat/clear");
      setStatus({ tone: "success", text: "Chat cleared for everyone." });
      toast.success("Chat cleared.");
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Couldn't clear the chat." });
      toast.error("Unable to clear chat. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="error-text">{error}</p>;
  if (!chat) return <p className="loading">Loading…</p>;

  return (
    <>
      <AdminCard
        title="Chat room"
        subtitle={`${chat.messageCount} message${chat.messageCount === 1 ? "" : "s"} stored`}
        actions={
          <Link to="/admin/chat" className="link-btn">
            Open chat
          </Link>
        }
      >
        <div className="admin-pill-row">
          <StatusPill status={chat.online.user} label="User online" />
          <StatusPill status={chat.online.admin} label="You online" />
          <StatusPill status={chat.reachable} label="Realtime" />
        </div>
        {chat.lastMessage && (
          <p className="subtle-text last-message">
            Last message ({timeAgo(chat.lastMessage.created_at)}): {chat.lastMessage.body}
          </p>
        )}
      </AdminCard>
      <AdminCard title="Moderation" subtitle="Delete individual messages inline in the Chat page; use this for a full reset.">
        <button onClick={clearChat} disabled={busy} className="btn-danger">
          {busy ? "Clearing…" : "Clear the entire chat"}
        </button>
        <p className="subtle-text">Both partners will lose the visible history. Logged in the audit trail.</p>
        {status && <FormStatus tone={status.tone}>{status.text}</FormStatus>}
      </AdminCard>
      {dialog}
    </>
  );
}

function NotificationsTab() {
  const [recipient, setRecipient] = useState<"user" | "admin">("user");
  const [type, setType] = useState("chat");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [list, setList] = useState<NotificationItem[]>([]);
  const [unreadUser, setUnreadUser] = useState(0);
  const [unreadAdmin, setUnreadAdmin] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function load() {
    api
      .get<{ notifications: NotificationItem[]; unreadUser: number; unreadAdmin: number }>("/admin/notifications")
      .then((r) => {
        setList(r.notifications);
        setUnreadUser(r.unreadUser);
        setUnreadAdmin(r.unreadAdmin);
      });
  }
  useEffect(load, []);

  async function send() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await api.post("/admin/notifications/send", { recipient, type, title: title.trim(), body: body.trim() });
      setTitle("");
      setBody("");
      load();
      setStatus({ tone: "success", text: `Notification delivered to ${recipient === "user" ? "the user" : "you"} (in-app${recipient === "admin" ? " + push" : ""}).` });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Couldn't send." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminCard
        title="Send a notification"
        subtitle="Goes to the user's in-app center; browser push fires for the admin's subscriptions."
      >
        <label htmlFor="notif-recipient">Recipient</label>
        <select id="notif-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value as "user" | "admin")}>
          <option value="user">The user (in-app)</option>
          <option value="admin">You (in-app + push)</option>
        </select>
        <label htmlFor="notif-type">Type</label>
        <select id="notif-type" value={type} onChange={(e) => setType(e.target.value)}>
          {NOTIFICATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label htmlFor="notif-title">Title</label>
        <input id="notif-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Thinking of you" />
        <label htmlFor="notif-body">Message</label>
        <textarea id="notif-body" value={body} maxLength={500} rows={3} onChange={(e) => setBody(e.target.value)} />
        <button onClick={send} disabled={busy || !title.trim() || !body.trim()}>
          {busy ? "Sending…" : "Send"}
        </button>
        {status && <FormStatus tone={status.tone}>{status.text}</FormStatus>}
      </AdminCard>

      <AdminCard
        title="Recent notifications"
        subtitle={`${unreadUser} unread for the user · ${unreadAdmin} unread for you`}
      >
        {list.length === 0 ? (
          <p className="subtle-text">Nothing sent yet.</p>
        ) : (
          <ul className="admin-list">
            {list.slice(0, 10).map((n) => (
              <li key={n.id} className="admin-list-item">
                <span className="admin-list-title">{n.title}</span>
                <span className="admin-list-detail">{n.body}</span>
                <span className="admin-list-meta">
                  {n.recipient} · {n.type} · {timeAgo(n.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}

function PushTab() {
  const [status, setStatus] = useState<{ configured: boolean; subscriptions: number; lastSeenAt: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api
      .get<{ configured: boolean; subscriptions: number; lastSeenAt: number | null }>("/push/status")
      .then(setStatus)
      .catch(() => setError("Couldn't load push status."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!status) return <p className="loading">Loading…</p>;

  return (
    <>
      <AdminCard
        title="Web Push"
        subtitle="Browser push is admin-only by design — the user's notifications stay in-app."
        actions={<StatusPill status={status.configured} label={status.configured ? "Configured" : "Not configured"} />}
      >
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Subscriptions</span>
            <span className="admin-row-value">{status.subscriptions}</span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Last seen</span>
            <span className="admin-row-value">{timeAgo(status.lastSeenAt)}</span>
          </div>
        </div>
        <p className="subtle-text">
          Enable, disable or test push from Settings → Notifications. Requires VAPID keys on the server.
        </p>
        <Link to="/admin/settings" className="link-btn">
          Go to Settings
        </Link>
      </AdminCard>
    </>
  );
}
