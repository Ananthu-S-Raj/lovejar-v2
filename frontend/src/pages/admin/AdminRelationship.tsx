import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import AdminCard from "../../components/admin/AdminCard";
import StatusPill from "../../components/admin/StatusPill";
import FormStatus from "../../components/admin/FormStatus";
import SectionTabs from "../../components/admin/SectionTabs";
import { useConfirm } from "../../components/admin/ConfirmDialog";
import { timeAgo, PET_STAGE_EMOJI, streakNextMilestone, gardenStageLabel } from "./utils";
import type { DashboardStreak, PetState } from "./types";

type Tab = "Streak" | "Affection" | "Pet";

export default function AdminRelationship() {
  const [tab, setTab] = useState<Tab>("Streak");
  return (
    <div className="page admin-page">
      <h2 className="admin-title">Relationship</h2>
      <p className="admin-subtitle">The warm stuff — streaks, affection and the pet you care for together.</p>
      <SectionTabs tabs={["Streak", "Affection", "Pet"]} active={tab} onChange={(t) => setTab(t as Tab)} />
      {tab === "Streak" && <StreakTab />}
      {tab === "Affection" && <AffectionTab />}
      {tab === "Pet" && <PetTab />}
    </div>
  );
}

function StreakTab() {
  const [streak, setStreak] = useState<DashboardStreak | null>(null);
  const [current, setCurrent] = useState("");
  const [longest, setLongest] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ask, dialog } = useConfirm();

  function load() {
    api.get<{ streak: DashboardStreak }>("/admin/dashboard").then((r) => {
      setStreak(r.streak);
      setCurrent(String(r.streak.current_streak));
      setLongest(String(r.streak.longest_streak));
    });
  }
  useEffect(load, []);

  async function adjust() {
    if (!streak) return;
    const ok = await ask({
      title: "Adjust the streak?",
      message: "This changes the shared streak. It's recorded in the audit log, so add a note below for why.",
      confirmLabel: "Adjust streak",
      tone: "default",
    });
    if (!ok) return;
    setBusy(true);
    setStatus(null);
    try {
      await api.post("/admin/jar/streak", {
        currentStreak: current.trim() !== "" ? Number(current) : undefined,
        longestStreak: longest.trim() !== "" ? Number(longest) : undefined,
        reason: reason.trim() || undefined,
      });
      load();
      setStatus({ tone: "success", text: "Streak updated." });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  if (!streak) return <p className="loading">Loading…</p>;

  const next = streakNextMilestone(streak.current_streak);
  const pct = streak.current_streak === 0 ? 0 : Math.min(100, Math.round((streak.current_streak / next.target) * 100));

  return (
    <>
      <AdminCard title="Day streak" subtitle={`${streak.current_streak} day streak · ${gardenStageLabel(streak.garden_stage)}`}>
        <div className="admin-stats">
          <StatusPill status={streak.current_streak > 0} label={`Current ${streak.current_streak} 🔥`} />
          <StatusPill status={true} label={`Longest ${streak.longest_streak}`} />
        </div>
        <p className="subtle-text">
          {pct}% of the way to {next.target} days — {next.remaining} to go.
        </p>
        <div className="streak-bar">
          <div className="streak-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="subtle-text">Last opened: {streak.last_open_date ?? "never"}</p>
      </AdminCard>

      <AdminCard title="Adjust the streak" subtitle="Correct mistakes or celebrate a milestone. Logged to the audit trail.">
        <div className="admin-grid-2">
          <div>
            <label htmlFor="streak-current">Current streak</label>
            <input id="streak-current" inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div>
            <label htmlFor="streak-longest">Longest streak</label>
            <input id="streak-longest" inputMode="numeric" value={longest} onChange={(e) => setLongest(e.target.value)} />
          </div>
        </div>
        <label htmlFor="streak-reason">Reason (shown in audit log)</label>
        <input id="streak-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fixed a typo on day 30" />
        <button onClick={adjust} disabled={busy}>
          {busy ? "Saving…" : "Adjust streak"}
        </button>
        {status && <FormStatus tone={status.tone}>{status.text}</FormStatus>}
      </AdminCard>
      {dialog}
    </>
  );
}

function AffectionTab() {
  const [busy, setBusy] = useState<"hug" | "kiss" | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ask, dialog } = useConfirm();

  async function send(kind: "hug" | "kiss") {
    const ok = await ask({
      title: kind === "hug" ? "Send a hug? 🤗" : "Send a kiss? 💋",
      message: `A ${kind} appears in the chat as a message from you, and ${kind === "hug" ? "a hug" : "a kiss"} notification is pushed to the user.`,
      confirmLabel: `Send ${kind}`,
      tone: "default",
    });
    if (!ok) return;
    setBusy(kind);
    setStatus(null);
    try {
      await api.post("/chat/affection", { kind });
      setStatus({ tone: "success", text: `A ${kind} was sent 💕` });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Couldn't send." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminCard
        title="Send affection"
        subtitle="A hug or kiss lands in the chat as an official message — the user sees it even when the app is closed."
      >
        <div className="admin-btn-row">
          <button onClick={() => send("hug")} disabled={busy !== null}>
            {busy === "hug" ? "Sending…" : "Send a hug 🤗"}
          </button>
          <button onClick={() => send("kiss")} disabled={busy !== null}>
            {busy === "kiss" ? "Sending…" : "Send a kiss 💋"}
          </button>
        </div>
        {status && <FormStatus tone={status.tone}>{status.text}</FormStatus>}
      </AdminCard>
      <AdminCard title="How it works">
        <p className="subtle-text">
          Affection is a first-class chat event (kind: hug or kiss). The message body is written server-side so both of
          you always see the same words, and the user gets an in-app notification with it.
        </p>
      </AdminCard>
      {dialog}
    </>
  );
}

function PetTab() {
  const [pet, setPet] = useState<PetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function load() {
    setError(null);
    api.get<PetState>("/pet").then(setPet).catch(() => setError("Couldn't load the pet."));
  }
  useEffect(load, []);

  async function care(action: "feed" | "play") {
    try {
      await api.post(`/pet/${action}`);
      load();
      setStatus({ tone: "success", text: action === "feed" ? "Fed the pet 🍎" : "Played with the pet 🎾" });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Couldn't do that." });
    }
  }

  if (error) return <p className="error-text">{error}</p>;
  if (!pet) return <p className="loading">Loading…</p>;

  const bar = (label: string, value: number) => (
    <div className="admin-row">
      <span className="admin-row-label">{label}</span>
      <span className="admin-row-value">
        <span className="stat-bar">
          <span className="stat-bar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </span>
        {value}%
      </span>
    </div>
  );

  return (
    <>
      <AdminCard
        title={`${PET_STAGE_EMOJI[pet.stage] ?? "🐾"} ${pet.name}`}
        subtitle={`${pet.stage} stage`}
        actions={<StatusPill status={pet.happiness > 40} label={`Happiness ${pet.happiness}%`} />}
      >
        <div className="admin-rows">
          {bar("Hunger", pet.hunger)}
          {bar("Happiness", pet.happiness)}
          {bar("Energy", pet.energy)}
        </div>
        <p className="subtle-text">
          Stats drift down over time (~1 point / 20 min) and rise when the pet is fed or played with — either of you can
          do it.
        </p>
        <div className="admin-btn-row">
          <button onClick={() => care("feed")}>Feed 🍎</button>
          <button onClick={() => care("play")}>Play 🎾</button>
        </div>
        {status && <FormStatus tone={status.tone}>{status.text}</FormStatus>}
      </AdminCard>
    </>
  );
}
