import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { sounds, vibrate } from "../lib/feedback";
import JarAtmosphere from "./JarAtmosphere";

type Mood = "happy" | "sad" | "need_energy" | "missing_you";

const MOODS: { key: Mood; label: string; emoji: string }[] = [
  { key: "happy", label: "Happy", emoji: "😊" },
  { key: "sad", label: "Sad", emoji: "😢" },
  { key: "need_energy", label: "Need Energy", emoji: "⚡" },
  { key: "missing_you", label: "Missing You", emoji: "🥺" },
];

type JarStatus = {
  opened: boolean;
  mood: string | null;
  message: string | null;
  isBirthday: boolean;
};

export default function Jar({
  status,
  onOpened,
}: {
  status: JarStatus;
  onOpened: (mood: string, message: string) => void;
}) {
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jarState, setJarState] = useState<"closed" | "opening" | "open">(status.opened ? "open" : "closed");

  async function handleOpen() {
    if (status.opened || !selectedMood || opening) return;
    setOpening(true);
    setError(null);
    setJarState("opening");
    vibrate([20, 40, 20]);
    try {
      const res = await api.post<{ message: string; mood: string }>("/jar/open", { mood: selectedMood });
      sounds.jarOpen();
      setTimeout(() => {
        setJarState("open");
        onOpened(res.mood, res.message);
      }, 600);
    } catch (e) {
      setJarState("closed");
      setError(e instanceof ApiError ? e.message : "Something went wrong opening the jar.");
      sounds.error();
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="jar-card">
      <JarAtmosphere boosted={opening || jarState === "open"} />
      <div className={`jar-visual ${jarState}`} aria-hidden>
        <div className="jar-glass">
          <div className="jar-glow" />
          <span className="jar-emoji">{jarState === "open" ? "💌" : "🫙"}</span>
        </div>
      </div>

      {status.opened ? (
        <div className="jar-message">
          <p className="jar-mood-tag">
            {MOODS.find((m) => m.key === status.mood)?.emoji} {MOODS.find((m) => m.key === status.mood)?.label}
          </p>
          <p className="jar-message-text">{status.message}</p>
          <p className="jar-hint">Come back tomorrow at 12:00 AM for a new message 💕</p>
        </div>
      ) : (
        <>
          <p className="jar-prompt">How are you feeling today?</p>
          <div className="mood-buttons">
            {MOODS.map((m) => (
              <button
                key={m.key}
                className={"mood-btn" + (selectedMood === m.key ? " selected" : "")}
                onClick={() => {
                  setSelectedMood(m.key);
                  sounds.tap();
                  vibrate(10);
                }}
              >
                <span>{m.emoji}</span>
                {m.label}
              </button>
            ))}
          </div>
          <button className="open-jar-btn" disabled={!selectedMood || opening} onClick={handleOpen}>
            {opening ? "Opening…" : "Open the Jar"}
          </button>
          {error && <p className="error-text">{error}</p>}
        </>
      )}
    </div>
  );
}
