import { useEffect } from "react";

type Props = {
  kind: "hug" | "kiss";
  onDone: () => void;
};

const COPY = {
  hug: { emoji: "🤗", title: "A big hug", sub: "sent with love" },
  kiss: { emoji: "💋", title: "Muah!", sub: "A kiss, just for you 💕" },
};

// Short, delightful full-screen moment shown to the sender. It never blocks
// interaction (pointer-events: none) and auto-dismisses.
export default function AffectionOverlay({ kind, onDone }: Props) {
  useEffect(() => {
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, [onDone]);

  const c = COPY[kind];
  return (
    <div className="affection-overlay" aria-hidden>
      <div className="affection-emoji">{c.emoji}</div>
      <div className="affection-title">{c.title}</div>
      <div className="affection-sub">{c.sub}</div>
    </div>
  );
}
