import { useEffect } from "react";

type Props = {
  milestone: number;
  onDone: () => void;
};

const MESSAGES: Record<number, string> = {
  3: "Three days of us — the spark is real 🔥",
  7: "One week of showing up for each other ❤️",
  15: "Two weeks and counting — you're my favorite routine 🌿",
  30: "A full month together — a seed has been planted 🌱",
  50: "50 days of love, stronger every day 🌸",
  100: "100 days! A whole forest of love 🌳",
};

export default function MilestoneCelebration({ milestone, onDone }: Props) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="milestone-celebration" role="status" aria-live="polite">
      <div className="milestone-emoji">🎉</div>
      <div className="milestone-number">{milestone}-day streak</div>
      <div className="milestone-msg">{MESSAGES[milestone] ?? "Look at us — never missing a day ❤️"}</div>
    </div>
  );
}
