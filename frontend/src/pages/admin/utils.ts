export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export const MOOD_EMOJI: Record<string, string> = {
  happy: "😊",
  sad: "🥺",
  need_energy: "⚡",
  missing_you: "💗",
};

export function moodLabel(mood: string | null | undefined): string {
  switch (mood) {
    case "happy":
      return "Happy";
    case "sad":
      return "Sad";
    case "need_energy":
      return "Need energy";
    case "missing_you":
      return "Missing you";
    default:
      return mood || "—";
  }
}

export const PET_STAGE_EMOJI: Record<string, string> = { baby: "🐣", teen: "🐤", adult: "🦅" };

export function streakNextMilestone(current: number): { target: number; remaining: number } {
  const milestones = [7, 30, 100, 365];
  const target = milestones.find((m) => m > current) ?? 365;
  return { target, remaining: Math.max(0, target - current) };
}

export function gardenStageLabel(stage: number): string {
  if (stage <= 0) return "Seedling";
  if (stage === 1) return "Sprouting";
  if (stage === 2) return "Growing";
  if (stage === 3) return "Blooming";
  if (stage === 4) return "Thriving";
  return "Full garden";
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("Clipboard unavailable"));
}
