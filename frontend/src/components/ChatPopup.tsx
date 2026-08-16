import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { sounds, haptic } from "../lib/feedback";
import { normalizeChatMessage, type ChatMessage } from "../lib/chat";

const POLL_MS = 10_000;
const AUTO_DISMISS_MS = 8_000;

// Floating mini-chat popup: while the app is open on any page (but not /chat),
// a fresh message from the peer surfaces as a small bubble with a tap-to-reply
// affordance, so a reply isn't just a silent badge. Reuses the chat read/unread
// state, so once the message is read (chat opened, notification center) the
// popup naturally stops.
export default function ChatPopupHost() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [popup, setPopup] = useState<ChatMessage | null>(null);
  const [names, setNames] = useState<{ user?: string; admin?: string }>({});
  const dismissedId = useRef(0);
  const lastNotifiedId = useRef(0);
  const autoDismiss = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The peer label comes from the configured names (with server defaults), never
  // hardcoded — the same source the chat page itself uses.
  useEffect(() => {
    api
      .get<{ names: { user?: string; admin?: string } }>("/chat/names")
      .then((r) => setNames(r.names ?? {}))
      .catch(() => undefined);
  }, []);

  // Never show a popup on the chat page itself (you're already there).
  useEffect(() => {
    if (location.pathname === "/chat" || location.pathname.endsWith("/chat")) {
      if (autoDismiss.current) clearTimeout(autoDismiss.current);
      setPopup(null);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!role) return;
    let cancelled = false;
    const peer = role === "admin" ? "user" : "admin";
    const poll = async () => {
      try {
        const { unread } = await api.get<{ unread: number }>("/chat/unread");
        if (unread <= 0) return;
        const { messages } = await api.get<{ messages: unknown[] }>("/chat/history");
        const normalized = (messages ?? []).map(normalizeChatMessage);
        const newest = normalized[normalized.length - 1];
        if (!newest || newest.sender !== peer) return;
        if (newest.id <= dismissedId.current) return;
        if (cancelled) return;
        setPopup(newest);
        if (newest.id !== lastNotifiedId.current) {
          lastNotifiedId.current = newest.id;
          sounds.message();
          haptic.medium();
        }
        if (autoDismiss.current) clearTimeout(autoDismiss.current);
        autoDismiss.current = setTimeout(() => {
          dismissedId.current = newest.id;
          setPopup(null);
        }, AUTO_DISMISS_MS);
      } catch {
        // transient network blip — retry on the next tick
      }
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      if (autoDismiss.current) clearTimeout(autoDismiss.current);
    };
  }, [role]);

  if (!popup) return null;

  const peerLabel = role === "admin" ? names.user ?? "Your partner" : names.admin ?? "Admin";
  const isAdminPath = location.pathname.startsWith("/admin");

  return (
    <button
      type="button"
      className="chat-popup"
      onClick={() => {
        setPopup(null);
        navigate(isAdminPath ? "/admin/chat" : "/chat");
      }}
    >
      <span
        className="chat-popup-close"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          dismissedId.current = popup.id;
          setPopup(null);
        }}
      >
        ✕
      </span>
      <span className="chat-popup-title">💬 {peerLabel} sent a message</span>
      <span className="chat-popup-body">{popup.body}</span>
      <span className="chat-popup-reply">Tap to reply →</span>
    </button>
  );
}
