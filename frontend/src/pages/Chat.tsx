import { useCallback, useEffect, useRef, useState } from "react";
import { api, wsUrl } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useChatUnread } from "../lib/useChatUnread";
import { sounds, haptic } from "../lib/feedback";
import { emitNotificationRefresh } from "../lib/notificationBus";
import { normalizeChatMessage, isMine, type ChatMessage } from "../lib/chat";
import IconButton from "../components/IconButton";
import AffectionOverlay from "../components/AffectionOverlay";
import { useConfirm } from "../components/admin/ConfirmDialog";
import { useToast } from "../components/ToastProvider";

type ConnState = "connecting" | "connected" | "offline";

const MAX_CHAT = 2000;

export default function Chat() {
  const { role } = useAuth();
  const { markRead } = useChatUnread();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [online, setOnline] = useState({ user: false, admin: false });
  const [peerTyping, setPeerTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [names, setNames] = useState<{ user?: string; admin?: string }>({});
  const [affection, setAffection] = useState<"hug" | "kiss" | null>(null);
  const { ask, dialog } = useConfirm();
  const toast = useToast();
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameBusy, setNicknameBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seenIds = useRef<Set<number>>(new Set());
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const stopHeartbeat = () => {
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  };

  const peerRole = role === "admin" ? "user" : "admin";
  const peerName = names[peerRole] ?? (peerRole === "admin" ? "Admin" : "Your partner");

  function loadHistory() {
    setError(null);
    api
      .get<{ messages: unknown[] }>("/chat/history")
      .then((r) => {
        const normalized = (r.messages ?? []).map(normalizeChatMessage);
        for (const m of normalized) seenIds.current.add(m.id);
        setMessages(normalized);
      })
      .catch(() => setError("Couldn't load chat history."));
  }

  function loadNames() {
    api
      .get<{ names: { user?: string; admin?: string } }>("/chat/names")
      .then((r) => setNames(r.names ?? {}))
      .catch(() => {
        // fallback names apply automatically
      });
  }

  // The user can give the Admin a persistent nickname (stored on the server).
  // Single source of truth stays /chat/names, so the header, status, sender
  // labels, popups and notifications all update together.
  async function saveNickname(e: React.FormEvent) {
    e.preventDefault();
    const clean = nicknameDraft.trim();
    if (!clean || nicknameBusy) return;
    setNicknameBusy(true);
    try {
      await api.post("/chat/nickname/admin", { nickname: clean });
      await loadNames();
      toast.success("Admin nickname updated ❤️");
      setEditingNickname(false);
    } catch {
      toast.error("Couldn't save the nickname.");
    } finally {
      setNicknameBusy(false);
    }
  }

  async function resetNickname() {
    if (nicknameBusy) return;
    setNicknameBusy(true);
    try {
      await api.delete("/chat/nickname/admin");
      await loadNames();
      setNicknameDraft("Admin");
      toast.success("Admin nickname reset.");
    } catch {
      toast.error("Couldn't reset the nickname.");
    } finally {
      setNicknameBusy(false);
    }
  }

  // Manual (UI-only) reconnect — full auto-reconnect/outbox is intentionally
  // deferred; tapping the offline pill re-establishes the socket.
  const connect = useCallback(() => {
    setConn("connecting");
    const ws = new WebSocket(wsUrl("/chat/ws"));
    wsRef.current = ws;

    ws.onopen = () => {
      setConn("connected");
      setError(null);
      // Heartbeat: prove liveness every 20s so the server's watchdog (45s)
      // never mistakes a healthy socket for a dead one. The server answers
      // with a pong that resets lastSeen; typing/messages reset it too.
      stopHeartbeat();
      pingTimer.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "ping" }));
        }
      }, 20_000);
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "message") {
        const msg = normalizeChatMessage(data);
        // Skip anything we've already rendered (history + live can overlap,
        // and the same message must never vibrate twice).
        if (seenIds.current.has(msg.id)) return;
        seenIds.current.add(msg.id);
        setMessages((prev) => [...prev, msg]);
        // Every incoming message, hug or kiss is also a new notification for
        // the peer — nudge the center to refresh right away (it polls too).
        emitNotificationRefresh();
        if (msg.sender !== role) {
          sounds.message();
          haptic.medium();
          // The user is looking at the chat right now, so mark these messages
          // read and clear the unread badge. (Own messages never count.)
          void markRead();
        }
      } else if (data.type === "presence") {
        setOnline(data.online);
      } else if (data.type === "pong") {
        // Heartbeat ack — nothing else to do; the server already refreshed
        // lastSeen when the ping arrived.
      } else if (data.type === "typing") {
        setPeerTyping(data.isTyping);
      } else if (data.type === "delete") {
        // Delete-for-everyone removes the message on both sides; delete-for-me
        // only removes it from the deleter's own view (matches server state).
        setMessages((prev) =>
          prev.filter((m) => {
            if (m.id !== data.id) return true;
            if (data.forEveryone) return false;
            return data.by !== role;
          })
        );
      } else if (data.type === "clear_result") {
        toast.success("Chat cleared.");
      } else if (data.type === "history_cleared") {
        // A per-side clear only clears the side that requested it; a full
        // clear (admin moderation, forEveryone) clears both. Never wipe the
        // peer's view just because we cleared ours.
        if (data.forEveryone || data.by === role) {
          setMessages([]);
          seenIds.current.clear();
        }
      } else if (data.type === "delete_result") {
        toast.success(data.forEveryone ? "Message deleted for both of you." : "Message deleted.");
      } else if (data.type === "error") {
        setError(data.message);
        toast.error(data.message);
        sounds.error();
        haptic.error();
      } else if (data.type === "admin_alert" && role === "admin") {
        sounds.error();
        haptic.strong();
      }
    };
    ws.onclose = () => {
      stopHeartbeat();
      if (wsRef.current === ws) {
        setConn("offline");
        setOnline({ user: false, admin: false });
      }
    };
    ws.onerror = () => {
      if (wsRef.current === ws) setConn("offline");
    };
  }, [role, markRead]);

  useEffect(() => {
    loadHistory();
    loadNames();
    connect();
    // Opening the chat marks anything received while away as read and clears
    // the unread badge.
    void markRead();
    return () => {
      stopHeartbeat();
      wsRef.current?.close();
      wsRef.current = null;
    };
    // reconnectNonce re-runs the effect for the manual "Reconnect" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, reconnectNonce]);

  // Safety net for presence: the socket broadcasts presence on changes, but if
  // the peer's socket died silently the server watchdog only notices after
  // ~45s. A light /chat/status poll keeps the online dot honest while the chat
  // is open, without a manual refresh.
  useEffect(() => {
    if (conn !== "connected") return;
    let cancelled = false;
    const poll = () =>
      api
        .get<{ online: { user: boolean; admin: boolean } }>("/chat/status")
        .then((r) => {
          if (!cancelled) setOnline(r.online);
        })
        .catch(() => undefined);
    poll();
    const t = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [conn]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendTyping = (isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "typing", isTyping }));
    }
  };

  function handleChange(v: string) {
    setDraft(v);
    sendTyping(true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => sendTyping(false), 1200);
  }

  function isOpen() {
    return wsRef.current?.readyState === WebSocket.OPEN;
  }

  function send() {
    const body = draft.trim();
    if (!body) return;
    const socket = wsRef.current;
    if (!isOpen() || !socket) {
      setError("You're offline right now — the message wasn't sent. Tap the status to reconnect.");
      sounds.error();
      haptic.error();
      return;
    }
    socket.send(JSON.stringify({ type: "message", body }));
    setDraft("");
    sendTyping(false);
    sounds.tap();
    haptic.light();
  }

  function sendAffection(kind: "hug" | "kiss") {
    const socket = wsRef.current;
    if (!isOpen() || !socket) {
      setError("You're offline right now — the hug didn't go through. Tap the status to reconnect.");
      sounds.error();
      haptic.error();
      return;
    }
    socket.send(JSON.stringify({ type: "message", body: "", kind }));
    setAffection(kind);
    if (kind === "hug") {
      sounds.hug();
      haptic.medium();
    } else {
      sounds.kiss();
      haptic.strong();
    }
  }

  function deleteMessage(id: number, forEveryone: boolean) {
    const socket = wsRef.current;
    if (!isOpen() || !socket) {
      toast.error("You're offline right now — the delete didn't go through.");
      return;
    }
    const run = () => {
      socket.send(JSON.stringify({ type: "delete", id, forEveryone }));
      haptic.light();
    };
    if (forEveryone) {
      // Delete-for-everyone is permanent and affects the other person, so it
      // always asks for confirmation before sending.
      void ask({
        title: "Delete for both of you?",
        message: "Delete this message for both of you? This can't be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      }).then((ok) => {
        if (ok) run();
      });
    } else {
      run();
    }
  }

  function clearHistory() {
    const socket = wsRef.current;
    if (!isOpen() || !socket) {
      toast.error("Unable to clear chat. Please try again.");
      return;
    }
    void ask({
      title: "Clear this conversation?",
      message: "Clear the chat history for you? This won't delete it for the other person.",
      confirmLabel: "Clear chat",
      cancelLabel: "Cancel",
    }).then((ok) => {
      if (!ok) return;
      socket.send(JSON.stringify({ type: "clear_history" }));
      haptic.light();
    });
  }

  const showCounter = draft.length > Math.round(MAX_CHAT * 0.1);

  return (
    <div className="page chat-page">
      <header className="chat-header">
        <span className="chat-peer">
          <span className={"status-dot" + (online[peerRole] ? " online" : "")} />
          <span className="chat-peer-name">{peerName}</span>
          {peerTyping && <span className="typing-indicator">typing…</span>}
          {role === "user" && (
            <IconButton
              size="sm"
              label="Set a nickname for the Admin"
              onClick={() => {
                setNicknameDraft(names.admin ?? "Admin");
                setEditingNickname((e) => !e);
              }}
            >
              ✏️
            </IconButton>
          )}
        </span>
        <span className="chat-header-spacer" />
        <button
          type="button"
          className={
            "conn-pill" +
            (conn === "connected"
              ? online[peerRole]
                ? " peer-online"
                : " peer-offline"
              : " " + conn)
          }
          aria-label={
            conn === "connected"
              ? online[peerRole]
                ? `${peerName} is online`
                : `${peerName} is offline`
              : conn === "connecting"
                ? "Connecting…"
                : "Offline — tap to reconnect"
          }
          onClick={() => {
            if (conn === "offline") {
              haptic.light();
              setReconnectNonce((n) => n + 1);
            }
          }}
        >
          <span className="conn-dot" />
          {conn === "connected"
            ? online[peerRole]
              ? `${peerName} is online`
              : `${peerName} is offline`
            : conn === "connecting"
              ? "Connecting…"
              : "Offline — tap to reconnect"}
        </button>
        <IconButton label="Clear chat history" onClick={clearHistory} destructive>
          🗑️
        </IconButton>
      </header>

      {editingNickname && (
        <form className="chat-nickname-editor" onSubmit={saveNickname}>
          <input
            type="text"
            value={nicknameDraft}
            onChange={(e) => setNicknameDraft(e.target.value)}
            maxLength={50}
            placeholder="What would you like to call Admin?"
            aria-label="Admin nickname"
            autoFocus
          />
          <button
            type="submit"
            className="nickname-save"
            disabled={nicknameBusy || !nicknameDraft.trim()}
          >
            {nicknameBusy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="link-btn" onClick={resetNickname} disabled={nicknameBusy}>
            Reset
          </button>
          <button type="button" className="link-btn" onClick={() => setEditingNickname(false)}>
            Cancel
          </button>
        </form>
      )}

      <div className="chat-messages" ref={scrollRef}>
        {error && (
          <div className="chat-notice">
            <span>{error}</span>
            <button className="link-btn" onClick={loadHistory}>
              Retry
            </button>
          </div>
        )}
        {messages.map((m) => {
          const mine = isMine(m, role);
          const kind = m.kind ?? "text";
          return (
            <div
              key={m.id}
              className={
                "chat-bubble" +
                (mine ? " mine" : " theirs") +
                (kind !== "text" ? " affection " + kind : "") +
                " enter"
              }
            >
              {kind === "text" && (
                <span className="bubble-sender">{mine ? "You" : peerName}</span>
              )}
              <p>{m.body}</p>
              {mine && (
                <div className="bubble-actions">
                  <IconButton size="sm" label="Delete for me" onClick={() => deleteMessage(m.id, false)}>
                    🚮
                  </IconButton>
                  <IconButton
                    size="sm"
                    label="Delete for both"
                    destructive
                    onClick={() => deleteMessage(m.id, true)}
                  >
                    🗑
                  </IconButton>
                </div>
              )}
            </div>
          );
        })}
        {messages.length === 0 && !error && (
          <p className="chat-empty">Say hi to {peerName} 💬</p>
        )}
      </div>

      <div className="chat-composer">
        <div className="affection-row">
          <button type="button" className="affection-btn" aria-label="Send a hug" onClick={() => sendAffection("hug")}>
            🤗 Hug
          </button>
          <button type="button" className="affection-btn" aria-label="Send a kiss" onClick={() => sendAffection("kiss")}>
            💋 Kiss
          </button>
        </div>
        <div className="composer-row">
          <textarea
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={MAX_CHAT}
            placeholder={`Message ${peerName}…`}
            aria-label="Message"
          />
          <button
            type="button"
            className="send-btn"
            aria-label="Send message"
            disabled={!draft.trim()}
            onClick={send}
          >
            ➤
          </button>
        </div>
        {showCounter && (
          <div className="composer-bottom">
            <span className="char-counter">{draft.length}/{MAX_CHAT}</span>
          </div>
        )}
      </div>

      {affection && <AffectionOverlay kind={affection} onDone={() => setAffection(null)} />}
      {dialog}
    </div>
  );
}
