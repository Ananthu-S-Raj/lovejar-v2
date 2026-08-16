import { useEffect, useState } from "react";
import { useNotifications } from "../lib/useNotifications";
import { isMuted, setMutedState } from "../lib/feedback";
import NotificationCenter from "./NotificationCenter";

// Floating shell header controls: the notification bell (with unread badge) and
// the universal sound toggle. Rendered once per layout in App.tsx so both the
// user and admin get the same control surface.
export default function UniversalControls() {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(() => isMuted());
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="universal-controls">
        <button
          type="button"
          className={"uc-btn" + (open ? " active" : "")}
          aria-label={open ? "Close notifications" : `Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="uc-emoji" aria-hidden>
            {open ? "✕" : "🔔"}
          </span>
          {!open && unreadCount > 0 && <span className="uc-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
        </button>
        <button
          type="button"
          className={"uc-btn" + (muted ? " muted" : "")}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          aria-pressed={!muted}
          onClick={() => {
            setMutedState(!muted);
            setMuted(!muted);
          }}
        >
          <span className="uc-emoji" aria-hidden>
            {muted ? "🔇" : "🔊"}
          </span>
        </button>
      </div>
      {open && (
        <NotificationCenter
          notifications={notifications}
          unreadCount={unreadCount}
          onRead={markRead}
          onReadAll={markAllRead}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
