import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { sounds, haptic } from "../lib/feedback";
import { useLettersUnread } from "../lib/useLettersUnread";
import { plantFor } from "./Streak";
import Jar from "../components/Jar";
import FloatingHearts from "../components/FloatingHearts";

type HomeInfo = { greeting: string; name: string; isBirthday: boolean };
type JarStatus = { opened: boolean; mood: string | null; message: string | null; isBirthday: boolean };
type StreakInfo = { currentStreak: number };

// Home-only shortcuts. Game / Streak / Letters are intentionally NOT in the
// primary navbar — the navbar holds every other destination instead.
const QUICK_ACTIONS = [
  { to: "/game", icon: "🎮", label: "Game" },
  { to: "/streak", icon: "🔥", label: "Streak" },
  { to: "/letters", icon: "💌", label: "Letters" },
];

// The welcome splash is for a fresh entry only (first page load / PWA relaunch).
// A module-level flag keeps it from replaying every time the user navigates back
// to Home mid-session, so returning home never flashes a full-screen overlay.
let welcomeShown = false;

// The Streak quick-action icon reflects the actual streak state by reusing the
// Streak feature's own visuals: the seedling before it starts, the streak
// flame while an active streak is building, and the garden plant once it is
// established (same plantFor logic the Streak page uses).
function streakQuickIcon(streak: number): string {
  if (streak <= 0) return "🌱";
  if (streak < 7) return "🔥";
  return plantFor(streak);
}

export default function Home() {
  const navigate = useNavigate();
  const { unread: lettersUnread } = useLettersUnread();
  const [info, setInfo] = useState<HomeInfo | null>(null);
  const [jarStatus, setJarStatus] = useState<JarStatus | null>(null);
  const [streakInfo, setStreakInfo] = useState<StreakInfo | null>(null);
  const [showWelcome, setShowWelcome] = useState(!welcomeShown);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api.get<HomeInfo>("/me/home").then(setInfo).catch(() => setError("Couldn't load your home."));
    api.get<JarStatus>("/jar/status").then(setJarStatus).catch(() => setError("Couldn't load the jar."));
    api.get<StreakInfo>("/streak").then(setStreakInfo).catch(() => undefined);
  }

  useEffect(() => {
    welcomeShown = true;
    load();
    const t = setTimeout(() => setShowWelcome(false), 1800);
    return () => clearTimeout(t);
  }, []);

  const name = info?.name ?? "there";

  const go = (to: string) => {
    sounds.tap();
    haptic.light();
    navigate(to);
  };

  if (showWelcome) {
    return (
      <div className="welcome-screen">
        <FloatingHearts count={14} />
        <div className="welcome-copy">
          <h1 className="welcome-text fade-in">Hello {name} ❤️</h1>
          <p className="welcome-kicker fade-in">Made with ❤️ for you</p>
        </div>
      </div>
    );
  }

  return (
    <div className={"page home-page" + (info?.isBirthday ? " birthday-theme" : "")}>
      <FloatingHearts count={10} />
      {info?.isBirthday && (
        <div className="birthday-banner">🎉 Happy Birthday, {name}! Today is all about you 🎂❤️</div>
      )}
      <h2 className="greeting">{info?.greeting ?? "Welcome back"}</h2>

      {error && (
        <div className="page-error">
          <p className="error-text">{error}</p>
          <button className="link-btn" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {jarStatus && (
        <Jar
          status={jarStatus}
          onOpened={(mood, message) => setJarStatus({ opened: true, mood, message, isBirthday: !!info?.isBirthday })}
        />
      )}

      <div className="quick-actions" role="group" aria-label="Quick actions">
        {QUICK_ACTIONS.map((a) => {
          const streak = streakInfo?.currentStreak ?? 0;
          const icon = a.to === "/streak" ? streakQuickIcon(streak) : a.icon;
          const badge = a.to === "/letters" ? lettersUnread : a.to === "/streak" ? streak : 0;
          return (
            <button
              key={a.to}
              type="button"
              className="quick-action"
              aria-label={badge > 0 ? `${a.label} (${badge}${a.to === "/streak" ? " days" : " unread"})` : a.label}
              onClick={() => go(a.to)}
            >
              <span className="quick-action-icon">
                {icon}
                {badge > 0 && <span className="nav-badge">{badge > 99 ? "99+" : badge}</span>}
              </span>
              <span className="quick-action-label">{a.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
