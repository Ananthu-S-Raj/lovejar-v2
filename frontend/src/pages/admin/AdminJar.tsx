import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import AdminCard from "../../components/admin/AdminCard";
import StatusPill from "../../components/admin/StatusPill";
import FormStatus from "../../components/admin/FormStatus";
import SectionTabs from "../../components/admin/SectionTabs";
import { useConfirm } from "../../components/admin/ConfirmDialog";
import { timeAgo, moodLabel, MOOD_EMOJI } from "./utils";
import type { JarStatus, JarEntry } from "./types";

type Tab = "Overview" | "Entries";

export default function AdminJar() {
  const [tab, setTab] = useState<Tab>("Overview");
  return (
    <div className="page admin-page">
      <h2 className="admin-title">Love Jar</h2>
      <p className="admin-subtitle">The user opens the jar once a day with a mood — here's what's in it.</p>
      <SectionTabs tabs={["Overview", "Entries"]} active={tab} onChange={(t) => setTab(t as Tab)} />
      {tab === "Overview" && <OverviewTab />}
      {tab === "Entries" && <EntriesTab />}
    </div>
  );
}

function OverviewTab() {
  const [status, setStatus] = useState<JarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ask, dialog } = useConfirm();

  function load() {
    setError(null);
    api.get<JarStatus>("/admin/jar/status").then(setStatus).catch(() => setError("Couldn't load jar status."));
  }
  useEffect(load, []);

  async function toggleAvailability() {
    if (!status) return;
    const pausing = status.available;
    if (pausing) {
      const ok = await ask({
        title: "Pause the jar?",
        message: "While paused, the user can't open today's jar — they'll see a gentle message instead. Their streak is untouched. Re-enable anytime.",
        confirmLabel: "Pause the jar",
      });
      if (!ok) return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api.post("/admin/jar/availability", { available: !pausing });
      load();
      setNotice({ tone: "success", text: pausing ? "Jar paused." : "Jar is live again." });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="error-text">{error}</p>;
  if (!status) return <p className="loading">Loading…</p>;

  return (
    <>
      <AdminCard
        title="Availability"
        subtitle="A real on/off switch — while paused, /open returns 423 and the user is told to check back later."
        actions={<StatusPill status={status.available} label={status.available ? "Open" : "Paused"} />}
      >
        <button onClick={toggleAvailability} disabled={busy} className={status.available ? "btn-danger" : ""}>
          {busy ? "Working…" : status.available ? "Pause the jar" : "Re-open the jar"}
        </button>
        {notice && <FormStatus tone={notice.tone}>{notice.text}</FormStatus>}
      </AdminCard>

      <AdminCard title="Today's entry" subtitle="What the user opened today, if they have">
        {status.today ? (
          <div className="admin-rows">
            <div className="admin-row">
              <span className="admin-row-label">Mood</span>
              <span className="admin-row-value">
                {MOOD_EMOJI[status.today.mood] ?? ""} {moodLabel(status.today.mood)} · {timeAgo(status.today.created_at)}
              </span>
            </div>
            <div className="admin-row">
              <span className="admin-row-label">Message</span>
              <span className="admin-row-value">“{status.today.message}”</span>
            </div>
          </div>
        ) : (
          <p className="subtle-text">{status.available ? "The user hasn't opened the jar today." : "Paused — no entry today."}</p>
        )}
      </AdminCard>

      <AdminCard title="AI generator" subtitle="Live Gemini when configured, fallback bank otherwise">
        <div className="admin-pill-row">
          <StatusPill status={status.ai.configured} label={status.ai.configured ? "Gemini configured" : "Fallback bank in use"} />
        </div>
        {status.ai.lastGeneration && (
          <div className="admin-rows">
            <div className="admin-row">
              <span className="admin-row-label">Last generation</span>
              <span className="admin-row-value">
                {MOOD_EMOJI[status.ai.lastGeneration.mood] ?? ""} {moodLabel(status.ai.lastGeneration.mood)} ·{" "}
                {status.ai.lastGeneration.source} · {timeAgo(status.ai.lastGeneration.created_at)}
              </span>
            </div>
            <div className="admin-row">
              <span className="admin-row-label">Message</span>
              <span className="admin-row-value">“{status.ai.lastGeneration.message}”</span>
            </div>
          </div>
        )}
        <p className="subtle-text">
          All-time: {status.ai.counts.gemini} generated by Gemini · {status.ai.counts.fallback} from the fallback bank.
        </p>
      </AdminCard>
      {dialog}
    </>
  );
}

function EntriesTab() {
  const [entries, setEntries] = useState<JarEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api.get<{ entries: JarEntry[] }>("/admin/jar/entries").then((r) => setEntries(r.entries)).catch(() => setError("Couldn't load jar entries."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!entries) return <p className="loading">Loading…</p>;

  return (
    <AdminCard title="Recent entries" subtitle="The last 30 days the jar was opened.">
      {entries.length === 0 ? (
        <p className="subtle-text">No entries yet — the first open will appear here.</p>
      ) : (
        <ul className="admin-list">
          {entries.map((e) => (
            <li key={e.date} className="admin-list-item">
              <span className="admin-list-title">
                {MOOD_EMOJI[e.mood] ?? ""} {moodLabel(e.mood)}
              </span>
              <span className="admin-list-detail">{e.message}</span>
              <span className="admin-list-meta">{e.date}</span>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}
