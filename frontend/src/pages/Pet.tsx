import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { sounds, haptic } from "../lib/feedback";
import { useToast } from "../components/ToastProvider";

type PetState = { name: string; hunger: number; happiness: number; energy: number; stage: string };

const STAGE_EMOJI: Record<string, string> = { baby: "🐣", teen: "🐤", adult: "🦅" };

type Particle = { id: number; x: number };

export default function Pet() {
  const [pet, setPet] = useState<PetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"feed" | "play" | null>(null);
  const [reacting, setReacting] = useState<"happy" | "love" | "eat" | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const particleId = useRef(0);
  const reactionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  function load() {
    setError(null);
    api.get<PetState>("/pet").then(setPet).catch(() => setError("Couldn't load the pet."));
  }
  useEffect(load, []);

  function burst(count: number) {
    const now = Date.now();
    const next: Particle[] = Array.from({ length: count }, () => ({
      id: now + particleId.current++,
      x: 20 + Math.random() * 60,
    }));
    setParticles((p) => [...p, ...next]);
    setTimeout(() => {
      setParticles((p) => p.filter((pt) => !next.some((n) => n.id === pt.id)));
    }, 1100);
  }

  function trigger(reaction: "happy" | "love" | "eat", sound: () => void, vibe: () => void, hearts = 4) {
    sound();
    vibe();
    setReacting(reaction);
    burst(hearts);
    if (reactionTimeout.current) clearTimeout(reactionTimeout.current);
    reactionTimeout.current = setTimeout(() => setReacting(null), 700);
  }

  // Double-tap guard: the buttons ignore taps while a request is in flight so
  // feed/play can't fire twice in a row.
  async function feed() {
    if (busy) return;
    setBusy("feed");
    try {
      await api.post("/pet/feed");
      trigger("eat", sounds.success, haptic.medium, 3);
      toast.success("Yum! They loved that 🍎");
      load();
    } catch {
      setError("Couldn't feed the pet right now.");
      toast.error("Couldn't feed the pet right now.");
    } finally {
      setBusy(null);
    }
  }

  async function play() {
    if (busy) return;
    setBusy("play");
    try {
      await api.post("/pet/play");
      trigger("happy", sounds.success, haptic.medium, 5);
      toast.success("So much fun! 🎈");
      load();
    } catch {
      setError("Couldn't play with the pet right now.");
      toast.error("Couldn't play with the pet right now.");
    } finally {
      setBusy(null);
    }
  }

  // Pure cosmetic: petting has no backend pet state, so it's a local reaction only.
  function petIt() {
    trigger("love", sounds.tap, haptic.light, 6);
  }

  if (error) {
    return (
      <div className="page pet-page">
        <h2>Pet</h2>
        <p className="error-text">{error}</p>
        <button onClick={load}>Retry</button>
      </div>
    );
  }
  if (!pet) return <div className="page loading">Loading…</div>;

  // Energy status is always shown and reflects the pet's actual rest gauge
  // (energy recovers with rest, so "sleepy" only appears below the 25 threshold).
  const hints: string[] = [];
  if (pet.energy >= 75) hints.push("Feeling energetic! ✨");
  else if (pet.energy >= 50) hints.push("Ready to play! 💕");
  else if (pet.energy >= 25) hints.push("Getting a little tired… 💤");
  else hints.push("They're sleepy — let them rest 💤");
  if (pet.hunger < 40) hints.push("They're hungry — time to feed them 🍎");
  if (pet.happiness < 40) hints.push("They could use some playtime 🎈");

  return (
    <div className="page pet-page">
      <h2>{pet.name}</h2>

      <div className={"pet-stage" + (reacting ? " " + reacting : "")} onClick={petIt}>
        <button type="button" className="pet-visual" aria-label={`Pet ${pet.name}`}>
          {STAGE_EMOJI[pet.stage] ?? "🐣"}
        </button>
        <div className="pet-particle-layer" aria-hidden>
          {particles.map((p) => (
            <span key={p.id} className="pet-particle" style={{ left: `${p.x}%` }}>
              {reacting === "eat" ? "🍎" : "💕"}
            </span>
          ))}
        </div>
        <p className="pet-hint">Tap {pet.name} to pet them</p>
      </div>

      <div className="pet-stats">
        <StatBar label="Hunger" value={pet.hunger} />
        <StatBar label="Happiness" value={pet.happiness} />
        <StatBar label="Energy" value={pet.energy} />
      </div>

      {hints.length > 0 && (
        <div className="pet-hints" role="status">
          {hints.map((h) => (
            <p key={h}>{h}</p>
          ))}
        </div>
      )}

      <div className="row-buttons">
        <button onClick={feed} disabled={busy !== null}>
          {busy === "feed" ? "Feeding…" : "Feed"}
        </button>
        <button onClick={play} disabled={busy !== null}>
          {busy === "play" ? "Playing…" : "Play"}
        </button>
      </div>
    </div>
  );
}

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-bar-row">
      <span className="stat-bar-label">{label}</span>
      <div className="stat-bar-track">
        <div className="stat-bar-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
