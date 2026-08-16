import type { NotificationItem } from "../lib/useNotifications";
import { haptic } from "../lib/feedback";

const TYPE_ICON: Record<string, string> = {
  chat: "💬",
  hug: "🤗",
  kiss: "💋",
  jar: "🫙",
  streak: "🔥",
  letter: "💌",
  bucket: "🪣",
  calendar: "📅",
  pet: "🐾",
  game: "🎮",
  security: "🔒",
};

function relativeTime(tsSec: number): string {
  const diff = Math.max(0, Date.now() / 1000 - tsSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(tsSec * 1000).toLocaleDateString();
}

type Props = {
  notifications: NotificationItem[];
  unreadCount: number;
  onRead: (id: number) => void;
  onReadAll: () => void;
  onClose: () => void;
};

export default function NotificationCenter({ notifications, unreadCount, onRead, onReadAll, onClose }: Props) {
  return (
    <>
      <div className="nc-backdrop" onClick={onClose} aria-hidden />
      <aside className="notification-center" role="dialog" aria-modal="true" aria-label="Notifications">
        <div className="nc-header">
          <h2 className="nc-title">Notifications</h2>
          {unreadCount > 0 && (
            <button type="button" className="nc-read-all" onClick={onReadAll}>
              Mark all read
            </button>
          )}
        </div>
        <div className="nc-list">
          {notifications.length === 0 ? (
            <p className="nc-empty">No notifications yet — moments here will show up as they happen.</p>
          ) : (
            notifications.map((n) => {
              const unread = n.read_at === null;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={"nc-item" + (unread ? " unread" : "")}
                  onClick={() => {
                    if (unread) {
                      onRead(n.id);
                      haptic.light();
                    }
                  }}
                >
                  <span className="nc-icon" aria-hidden>
                    {TYPE_ICON[n.type] ?? "✨"}
                  </span>
                  <span className="nc-body">
                    <span className="nc-line1">
                      <span className="nc-title">{n.title}</span>
                      {unread && <span className="nc-dot" aria-label="unread" />}
                    </span>
                    <span className="nc-line2">{n.body}</span>
                    <span className="nc-time">{relativeTime(n.created_at)}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
