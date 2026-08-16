import { NavLink } from "react-router-dom";
import { sounds, haptic } from "../lib/feedback";
import { useChatUnread } from "../lib/useChatUnread";

type Tab = { to: string; label: string; icon: string };

// The primary navbar carries every user destination that is NOT a Home quick
// action. Game / Streak / Letters live on Home only — nothing is duplicated.
const PRIMARY: Tab[] = [
  { to: "/", label: "Home", icon: "🏠" },
  { to: "/chat", label: "Chat", icon: "💬" },
  { to: "/bucket-list", label: "Bucket List", icon: "🪣" },
  { to: "/calendar", label: "Calendar", icon: "📅" },
  { to: "/pet", label: "Pet", icon: "🐾" },
  { to: "/weather", label: "Weather", icon: "🌦️" },
];

export default function NavBar() {
  const { unread: chatUnread } = useChatUnread();

  const navTap = () => {
    sounds.tap();
    haptic.light();
  };

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {PRIMARY.map((t) => {
        const badge = t.to === "/chat" ? chatUnread : 0;
        return (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === "/"}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
            onClick={navTap}
            aria-label={badge > 0 ? `${t.label} (${badge} unread)` : t.label}
          >
            <span className="nav-icon">
              {t.icon}
              {badge > 0 && <span className="nav-badge">{badge > 99 ? "99+" : badge}</span>}
            </span>
            <span className="nav-label">{t.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
