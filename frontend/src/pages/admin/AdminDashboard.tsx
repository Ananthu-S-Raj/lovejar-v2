import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import AdminCard from "../../components/admin/AdminCard";
import StatusPill from "../../components/admin/StatusPill";
import StatTile from "../../components/admin/StatTile";
import type { Dashboard } from "./types";
import {
  timeAgo,
  fmtTime,
  fmtDate,
  moodLabel,
  MOOD_EMOJI,
  PET_STAGE_EMOJI,
  streakNextMilestone,
  gardenStageLabel,
} from "./utils";
import { useAuth } from "../../lib/AuthContext";

const DASHBOARD_ERRORS: Record<number, string> = {
  401: "Your session expired — sign in again.",
  403: "You don't have permission to view the dashboard.",
  404: "The dashboard endpoint wasn't found.",
  500: "The server hit an error while loading the dashboard.",
  503: "The dashboard service is unavailable — try again shortly.",
  0: "The dashboard request timed out or the network dropped. Try again.",
};

export default function AdminDashboard() {
  const { loading, authReady, role } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Transient failures (backend blip, D1 hiccup, cold start) auto-retry once
  // with a short backoff so the dashboard self-heals without user intervention.
  const [retrying, setRetrying] = useState(false);
  const inFlightRef = useRef(false);
  const retriedRef = useRef(false);

  const TRANSIENT = new Set([500, 503, 0]);

  function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setData(null);
    api
      .get<Dashboard>("/admin/dashboard")
      .then((d) => {
        setData(d);
        retriedRef.current = false;
        inFlightRef.current = false;
      })
      .catch((err) => {
        // Never swallow the failure: log the real status/payload so an
        // intermittent dashboard outage is diagnosable, and surface a specific
        // message per failure type (401/403/404/500/503/timeout/network).
        const status = err instanceof ApiError ? err.status : null;
        console.error("[AdminDashboard] load failed", status ?? "unknown", err);
        if (status === 401) {
          inFlightRef.current = false; // api.ts already routed the sign-in redirect
          return;
        }
        if (TRANSIENT.has(status as number) && !retriedRef.current) {
          // One automatic retry for transient failures; the user-visible Retry
          // button re-runs load() for anything persistent.
          retriedRef.current = true;
          setRetrying(true);
          window.setTimeout(() => {
            setRetrying(false);
            inFlightRef.current = false;
            load();
          }, 1200);
          return;
        }
        setError(DASHBOARD_ERRORS[status as number] ?? err.message ?? "Couldn't load the dashboard.");
        inFlightRef.current = false;
      });
  }

  useEffect(() => {
    if (authReady && role === "admin") {
      load();
    }
  }, [authReady, role]);

  if (error) {
    return (
      <div className="page admin-page">
        <h2>Dashboard</h2>
        <p className="error-text">{error}</p>
        <button onClick={load}>Retry</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page loading">
        {retrying ? "Reconnecting…" : "Loading…"}
      </div>
    );
  }

  const next = streakNextMilestone(data.streak.current_streak);
  const progressPct =
    data.streak.current_streak === 0
      ? 0
      : Math.min(100, Math.round((data.streak.current_streak / next.target) * 100));

  return (
    <div className="page admin-page">
      <h2 className="admin-title">Dashboard</h2>
      <p className="admin-subtitle">
        {data.user.userNickname}
        {data.user.loginEnabled ? " is active" : " has login paused"} · last activity{" "}
        {timeAgo(data.user.lastActivity)}
      </p>

      <div className="admin-stats">
        <StatTile label="Day streak" value={`${data.streak.current_streak}🔥`} />
        <StatTile label="Longest streak" value={data.streak.longest_streak} />
        <StatTile
          label="Jar today"
          value={data.jar.today ? MOOD_EMOJI[data.jar.today.mood] ?? "✅" : "⏳"}
          hint={data.jar.today ? "Opened" : "Not opened yet"}
        />
        <StatTile
          label="Chat messages"
          value={data.chat.messageCount}
          hint={`${data.chat.online.user && data.chat.online.admin ? "Both online" : data.chat.online.user ? "Only user online" : data.chat.online.admin ? "Only you online" : "Nobody online"}`}
        />
      </div>

      <AdminCard
        title="At a glance"
        subtitle="The day in one place"
        actions={<Link to="/admin/user" className="link-btn">Manage</Link>}
      >
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Today's jar</span>
            {data.jar.today ? (
              <span className="admin-row-value">
                {MOOD_EMOJI[data.jar.today.mood] ?? ""} {moodLabel(data.jar.today.mood)} · {timeAgo(data.jar.today.created_at)}
              </span>
            ) : data.jar.available ? (
              <span className="admin-row-value subtle-text">Not opened yet</span>
            ) : (
              <span className="admin-row-value warn-text">Paused — {data.jar.today ? "opened" : "user can't open today"}</span>
            )}
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Streak progress</span>
            <span className="admin-row-value">
              {progressPct}% to {next.target} days
              <span className="streak-bar">
                <span className="streak-bar-fill" style={{ width: `${progressPct}%` }} />
              </span>
            </span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Garden</span>
            <span className="admin-row-value">{gardenStageLabel(data.streak.garden_stage)} 🌱</span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Pet</span>
            <span className="admin-row-value">
              {PET_STAGE_EMOJI[data.pet.stage] ?? "🐾"} {data.pet.name} · {data.pet.stage}
            </span>
          </div>
        </div>
      </AdminCard>

      <AdminCard
        title="Live"
        subtitle="Presence and recent activity"
        actions={<Link to="/admin/communication" className="link-btn">Communication</Link>}
      >
        <div className="admin-pill-row">
          <StatusPill status={data.chat.online.user} label={`${data.user.userNickname} online`} />
          <StatusPill status={data.chat.online.admin} label="You online" />
          <StatusPill status={data.chat.reachable} label="Realtime connected" />
        </div>
        {data.chat.lastMessage ? (
          <p className="subtle-text last-message">
            Last message ({timeAgo(data.chat.lastMessage.created_at)}): {data.chat.lastMessage.body}
          </p>
        ) : (
          <p className="subtle-text">No messages yet — say hi 💌</p>
        )}
      </AdminCard>

      <AdminCard
        title="Authentication"
        subtitle={`${data.user.userNickname}'s sign-in health`}
        actions={<Link to="/admin/user" className="link-btn">User</Link>}
      >
        <div className="admin-pill-row">
          <StatusPill status={!data.user.security.blocked} label={data.user.security.blocked ? "Login blocked" : "Normal"} />
          <StatusPill
            status={data.user.security.failed24h === 0}
            label={`${data.user.security.failed24h} failed in 24h`}
          />
        </div>
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Last successful login</span>
            <span className="admin-row-value">
              {data.user.security.lastSuccess ? timeAgo(data.user.security.lastSuccess) : "Never"}
            </span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Protection window</span>
            <span className="admin-row-value">
              {data.user.security.failedInWindow}/{data.user.security.maxFailures} failed ·{" "}
              {Math.round(data.user.security.windowSeconds / 60)} min · {data.user.security.locked} blocked
            </span>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Upcoming events" subtitle="Next 7 days">
        {data.calendar.upcoming.length === 0 ? (
          <p className="subtle-text">Nothing scheduled in the next week.</p>
        ) : (
          <ul className="admin-list">
            {data.calendar.upcoming.map((e) => (
              <li key={e.id} className="admin-list-item">
                <span className="admin-list-title">{e.title}</span>
                <span className="admin-list-meta">
                  {fmtDate(e.event_date)}
                  {e.event_time ? ` at ${e.event_time}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard
        title="Unread notifications"
        actions={<Link to="/admin/communication" className="link-btn">View</Link>}
      >
        <div className="admin-pill-row">
          <StatusPill status={data.notifications.unreadUser === 0} label={`User: ${data.notifications.unreadUser} unread`} />
          <StatusPill status={data.notifications.unreadAdmin === 0} label={`You: ${data.notifications.unreadAdmin} unread`} />
        </div>
        {data.notifications.recent.length > 0 && (
          <ul className="admin-list">
            {data.notifications.recent.slice(0, 3).map((n) => (
              <li key={n.id} className="admin-list-item">
                <span className="admin-list-title">{n.title}</span>
                <span className="admin-list-meta">
                  {n.recipient === "user" ? "→ user" : "→ you"} · {timeAgo(n.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard title="Recent admin activity" subtitle="What's changed around here">
        {data.activity.recent.length === 0 ? (
          <p className="subtle-text">No admin actions recorded yet.</p>
        ) : (
          <ul className="admin-list">
            {data.activity.recent.map((a, i) => (
              <li key={i} className="admin-list-item">
                <span className="admin-list-title mono-text">{a.action}</span>
                <span className="admin-list-meta">{fmtTime(a.created_at)}</span>
                {a.detail && <span className="admin-list-detail">{a.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard title="System health" subtitle="Service status at a glance">
        <div className="admin-pill-row">
          <StatusPill status={data.health.aiConfigured} label="AI" />
          <StatusPill status={data.health.weatherConfigured} label="Weather" />
          <StatusPill status={data.health.pushConfigured} label="Push" />
          <StatusPill status={data.health.realtimeReachable} label="Realtime" />
        </div>
        <p className="subtle-text">Details live in System → Health.</p>
      </AdminCard>
    </div>
  );
}
