import { useMemo } from "react";

const GLYPHS = ["💗", "💕", "🌸", "✨", "🌹", "🩷"];

// Deterministic PRNG (mulberry32) with a fixed seed so the particle field is
// identical on every render and reconnect — no re-layout jitter.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Particle = {
  left: number;
  size: number;
  dur: number;
  delay: number;
  drift: number;
  glyph: string;
};

function makeParticles(count: number, rand: () => number): Particle[] {
  return Array.from({ length: count }, () => ({
    left: rand() * 100,
    size: 12 + rand() * 16,
    dur: 7 + rand() * 9,
    delay: -rand() * 14, // negative delay pre-populates the field
    drift: (rand() - 0.5) * 70,
    glyph: GLYPHS[Math.floor(rand() * GLYPHS.length)],
  }));
}

// Decorative, ambient particles drifting up around the jar. Purely visual and
// aria-hidden; motion is disabled by the global prefers-reduced-motion rule.
export default function JarAtmosphere({ boosted = false }: { boosted?: boolean }) {
  const particles = useMemo(() => {
    const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
    return makeParticles(desktop ? 20 : 12, mulberry32(20260814));
  }, []);

  return (
    <div className={"jar-atmosphere" + (boosted ? " boosted" : "")} aria-hidden>
      {particles.map((p, i) => (
        <span
          key={i}
          className="jar-particle"
          style={
            {
              left: `${p.left}%`,
              fontSize: `${p.size}px`,
              "--dur": `${p.dur}s`,
              "--delay": `${p.delay}s`,
              "--drift": `${p.drift}px`,
            } as React.CSSProperties
          }
        >
          {p.glyph}
        </span>
      ))}
    </div>
  );
}
