import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { sounds, haptic } from "../lib/feedback";
import MilestoneCelebration from "../components/MilestoneCelebration";

type StreakInfo = {
  currentStreak: number;
  longestStreak: number;
  gardenStage: number;
  seedUnlocked: boolean;
};

const MILESTONES = [3, 7, 15, 30, 50, 100];

// Visual plant progression by streak (purely cosmetic — business logic that
// computes the streak is unchanged). Exported so the Home quick action shows
// the exact same garden state as the Streak page (single source of truth).
export function plantFor(streak: number): string {
  if (streak >= 100) return "🌳🌸";
  if (streak >= 30) return "🌸🌳";
  if (streak >= 15) return "🌳";
  if (streak >= 7) return "🌿";
  return "🌱";
}

function nextMilestone(streak: number): number {
  return MILESTONES.find((m) => m > streak) ?? 0;
}

function readCelebrated(): number[] {
  try {
    const raw = localStorage.getItem("lj_milestones_celebrated");
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

export default function Streak() {
  const [info, setInfo] = useState<StreakInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState<number | null>(null);

  function load() {
    setError(null);
    api.get<StreakInfo>("/streak").then(setInfo).catch(() => setError("Couldn't load your streak."));
  }

  useEffect(load, []);

  // Celebrate a milestone at most once (persisted in localStorage).
  useEffect(() => {
    if (!info || info.currentStreak <= 0) return;
    const reached = MILESTONES.filter((m) => info.currentStreak >= m);
    if (reached.length === 0) return;
    const celebrated = readCelebrated();
    const top = reached[reached.length - 1];
    if (!celebrated.includes(top)) {
      setCelebrating(top);
      sounds.milestone();
      haptic.strong();
      try {
        localStorage.setItem("lj_milestones_celebrated", JSON.stringify([...celebrated, top]));
      } catch {
        // storage unavailable — celebration simply repeats next visit
      }
    }
  }, [info]);

  const plant = plantFor(info?.currentStreak ?? 0);
  const next = nextMilestone(info?.currentStreak ?? 0);
  const progress = next > 0 ? Math.min(100, Math.round(((info?.currentStreak ?? 0) / next) * 100)) : 100;

  if (error) {
    return (
      <div className="page">
        <h2>Streak</h2>
        <p className="error-text">{error}</p>
        <button onClick={load}>Retry</button>
      </div>
    );
  }
  if (!info) return <div className="page loading">Loading…</div>;

  return (
    <div className="page streak-page">
      <h2>Our Streak</h2>

      <div className="streak-hero">
        <span className="streak-flame">🔥</span>
        <div className="streak-number">{info.currentStreak}</div>
        <div className="streak-unit">DAY{info.currentStreak === 1 ? "" : "S"} STREAK</div>
      </div>

      <div className="streak-stats">
        <div className="streak-stat">
          <span className="stat-number">{info.longestStreak}</span>
          <span className="stat-label">longest</span>
        </div>
        <div className="streak-stat">
          <span className="stat-emoji">{plant}</span>
          <span className="stat-label">garden</span>
        </div>
      </div>

      <div className="garden">
        <span className="garden-emoji">{plant}</span>
        <p className="subtle">
          {!info.seedUnlocked
            ? "Keep opening the jar — your seed sprouts at 30 days 🌱"
            : "Your garden keeps growing with every streak milestone!"}
        </p>
      </div>

      {next > 0 && (
        <div className="progress-block">
          <div className="progress-head">
            <span className="progress-now">{info.currentStreak} / {next}</span>
            <span className="progress-note">to {next} days</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="milestones">
        {MILESTONES.map((m) => {
          const reached = info.currentStreak >= m;
          return (
            <div key={m} className={"milestone-chip" + (reached ? " reached" : "")}>
              <span className="milestone-dot">{reached ? "✓" : m}</span>
            </div>
          );
        })}
      </div>

      {celebrating !== null && <MilestoneCelebration milestone={celebrating} onDone={() => setCelebrating(null)} />}
    </div>
  );
}
