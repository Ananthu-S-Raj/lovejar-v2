import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import AdminCard from "../../components/admin/AdminCard";
import StatusPill from "../../components/admin/StatusPill";
import SectionTabs from "../../components/admin/SectionTabs";
import { fmtDate, timeAgo } from "./utils";
import type { GameScore, CalendarEvent, BucketItem, WeatherStatus } from "./types";

type Tab = "Game" | "Calendar" | "Bucket List" | "Weather";

export default function AdminActivities() {
  const [tab, setTab] = useState<Tab>("Game");
  return (
    <div className="page admin-page">
      <h2 className="admin-title">Activities</h2>
      <p className="admin-subtitle">Everything you do together — the game, plans, dreams and the weather.</p>
      <SectionTabs tabs={["Game", "Calendar", "Bucket List", "Weather"]} active={tab} onChange={(t) => setTab(t as Tab)} />
      {tab === "Game" && <GameTab />}
      {tab === "Calendar" && <CalendarTab />}
      {tab === "Bucket List" && <BucketTab />}
      {tab === "Weather" && <WeatherTab />}
    </div>
  );
}

function GameTab() {
  const [data, setData] = useState<{ best: GameScore | null; recent: GameScore[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api
      .get<{ best: GameScore | null; recent: GameScore[] }>("/admin/game/scores")
      .then(setData)
      .catch(() => setError("Couldn't load game scores."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!data) return <p className="loading">Loading…</p>;

  return (
    <>
      <AdminCard title="Game" subtitle="The little love game only the user plays — their best lives here.">
        {data.best ? (
          <div className="admin-rows">
            <div className="admin-row">
              <span className="admin-row-label">Best score</span>
              <span className="admin-row-value">
                {data.best.score} · {timeAgo(data.best.created_at)}
              </span>
            </div>
            {data.best.message && (
              <div className="admin-row">
                <span className="admin-row-label">They said</span>
                <span className="admin-row-value">“{data.best.message}”</span>
              </div>
            )}
          </div>
        ) : (
          <p className="subtle-text">No games played yet.</p>
        )}
      </AdminCard>
      <AdminCard title="Recent scores" subtitle="The last 10 rounds">
        {data.recent.length === 0 ? (
          <p className="subtle-text">Nothing yet.</p>
        ) : (
          <ul className="admin-list">
            {data.recent.map((s, i) => (
              <li key={i} className="admin-list-item">
                <span className="admin-list-title">{s.score} pts</span>
                <span className="admin-list-meta">{timeAgo(s.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}

function CalendarTab() {
  const [events, setEvents] = useState<{ events: CalendarEvent[]; upcoming: CalendarEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api
      .get<{ events: CalendarEvent[]; upcoming: CalendarEvent[] }>("/calendar")
      .then(setEvents)
      .catch(() => setError("Couldn't load events."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!events) return <p className="loading">Loading…</p>;

  const upcoming = events.upcoming;
  const past = events.events.filter((e) => !upcoming.some((u) => u.id === e.id)).slice(0, 5);

  return (
    <>
      <AdminCard title="Upcoming" subtitle="Next 7 days">
        {upcoming.length === 0 ? (
          <p className="subtle-text">Nothing scheduled in the next week. Add events in the Events page.</p>
        ) : (
          <ul className="admin-list">
            {upcoming.map((e) => (
              <li key={e.id} className="admin-list-item">
                <span className="admin-list-title">{e.title}</span>
                <span className="admin-list-detail">{e.description}</span>
                <span className="admin-list-meta">
                  {fmtDate(e.event_date)}
                  {e.event_time ? ` at ${e.event_time}` : ""} · added by {e.created_by}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
      <AdminCard title="Further out" subtitle="Recent other events">
        {past.length === 0 ? (
          <p className="subtle-text">No other events.</p>
        ) : (
          <ul className="admin-list">
            {past.map((e) => (
              <li key={e.id} className="admin-list-item">
                <span className="admin-list-title">{e.title}</span>
                <span className="admin-list-meta">{fmtDate(e.event_date)}</span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}

function BucketTab() {
  const [items, setItems] = useState<BucketItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api.get<{ items: BucketItem[] }>("/bucket-list").then((r) => setItems(r.items)).catch(() => setError("Couldn't load the bucket list."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!items) return <p className="loading">Loading…</p>;

  const open = items.filter((i) => i.completed === 0);
  const done = items.filter((i) => i.completed === 1);
  const pct = items.length === 0 ? 0 : Math.round((done.length / items.length) * 100);

  return (
    <>
      <AdminCard title="Bucket list" subtitle={`${done.length} of ${items.length} dreams checked off (${pct}%)`}>
        {items.length === 0 ? (
          <p className="subtle-text">The bucket list is empty. Add dreams together in the Bucket List page.</p>
        ) : (
          <>
            <h4 className="admin-card-subhead">Open dreams</h4>
            <ul className="admin-list">
              {open.map((i) => (
                <li key={i.id} className="admin-list-item">
                  <span className="admin-list-title">{i.title}</span>
                  <span className="admin-list-detail">{i.description}</span>
                  <span className="admin-list-meta">added by {i.created_by}</span>
                </li>
              ))}
            </ul>
            {done.length > 0 && (
              <>
                <h4 className="admin-card-subhead">Done ✓</h4>
                <ul className="admin-list">
                  {done.map((i) => (
                    <li key={i.id} className="admin-list-item">
                      <span className="admin-list-title">{i.title}</span>
                      <span className="admin-list-meta">checked off {timeAgo(i.completed_at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </AdminCard>
    </>
  );
}

function WeatherTab() {
  const [status, setStatus] = useState<WeatherStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api.get<WeatherStatus>("/admin/weather/status").then(setStatus).catch(() => setError("Couldn't load weather status."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!status) return <p className="loading">Loading…</p>;

  const cached = status.cached as { temp_c?: number; condition?: string; city?: string } | null;

  return (
    <AdminCard
      title="Weather"
      subtitle="Live for the user, cached for you — here's the latest snapshot."
      actions={<StatusPill status={status.configured} label={status.configured ? "API configured" : "Not configured"} />}
    >
      {cached ? (
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Now</span>
            <span className="admin-row-value">
              {cached.city ? `${cached.city} — ` : ""}
              {cached.temp_c != null ? `${cached.temp_c}°C` : ""}
              {cached.condition ? ` · ${cached.condition}` : ""}
            </span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Cached</span>
            <span className="admin-row-value">{timeAgo(status.updatedAt)}</span>
          </div>
        </div>
      ) : (
        <p className="subtle-text">
          {status.configured ? "No cached forecast yet — it appears after the user first opens Weather." : "Weather isn't configured on the server (WEATHER_API_KEY missing)."}
        </p>
      )}
    </AdminCard>
  );
}
