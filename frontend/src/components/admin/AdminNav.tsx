import { NavLink, useNavigate } from "react-router-dom";
import { sounds, haptic } from "../../lib/feedback";
import { useAuth } from "../../lib/AuthContext";
import { useChatUnread } from "../../lib/useChatUnread";

type Tab = { to: string; label: string; icon: string; end?: boolean };

// Every admin destination, in canonical order. The same list drives the mobile
// bottom nav (horizontally scrollable) and the desktop sidebar — there is no
// "More" menu anywhere.
const ALL_TABS: Tab[] = [
  { to: "/admin", label: "Dashboard", icon: "🏠", end: true },
  { to: "/admin/user", label: "User", icon: "👤" },
  { to: "/admin/jar", label: "Jar", icon: "🫙" },
  { to: "/admin/relationship", label: "Relationship", icon: "💞" },
  { to: "/admin/communication", label: "Communication", icon: "💬" },
  { to: "/admin/activities", label: "Activities", icon: "🎮" },
  { to: "/admin/system", label: "System", icon: "🖥️" },
  { to: "/admin/chat", label: "Chat", icon: "✉️" },
  { to: "/admin/letters", label: "Letters", icon: "💌" },
  { to: "/admin/calendar", label: "Events", icon: "📅" },
  { to: "/admin/bucket-list", label: "Bucket List", icon: "🪣" },
  { to: "/admin/pet", label: "Pet", icon: "🐾" },
  { to: "/admin/weather", label: "Weather", icon: "🌦️" },
  { to: "/admin/settings", label: "Settings", icon: "⚙️" },
];

const SIDEBAR: { section: string; tabs: Tab[] }[] = [
  {
    section: "Control Center",
    tabs: ALL_TABS.slice(0, 7),
  },
  {
    section: "Features",
    tabs: ALL_TABS.slice(7),
  },
];

export default function AdminNav() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { unread } = useChatUnread();

  const navTap = () => {
    sounds.tap();
    haptic.light();
  };

  async function signOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <>
      {/* Mobile bottom navigation — horizontally scrollable, every destination
          is one tap away. No "More" menu. */}
      <nav className="bottom-nav admin-bottom-nav" aria-label="Admin control center">
        {ALL_TABS.map((t) => {
          const isChat = t.to === "/admin/chat";
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
              onClick={navTap}
              aria-label={isChat && unread > 0 ? `Chat (${unread} unread)` : t.label}
            >
              <span className="nav-icon">
                {t.icon}
                {isChat && unread > 0 && <span className="nav-badge">{unread > 99 ? "99+" : unread}</span>}
              </span>
              <span className="nav-label">{t.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Desktop sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">LoveJar Admin</div>
        {SIDEBAR.map((group) => (
          <nav key={group.section} className="admin-sidebar-group" aria-label={group.section}>
            <div className="admin-sidebar-heading">{group.section}</div>
            {group.tabs.map((t) => {
              const isChat = t.to === "/admin/chat";
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) => "admin-sidebar-item" + (isActive ? " active" : "")}
                  onClick={navTap}
                  aria-label={isChat && unread > 0 ? `Chat (${unread} unread)` : t.label}
                >
                  <span className="nav-icon" aria-hidden>
                    {t.icon}
                    {isChat && unread > 0 && <span className="admin-sidebar-badge">{unread > 99 ? "99+" : unread}</span>}
                  </span>
                  <span className="admin-sidebar-label">{t.label}</span>
                </NavLink>
              );
            })}
          </nav>
        ))}
        <button type="button" className="admin-sidebar-logout" onClick={signOut}>
          <span aria-hidden>🚪</span> Sign out
        </button>
      </aside>
    </>
  );
}
