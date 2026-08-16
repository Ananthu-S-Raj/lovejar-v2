import { useMemo } from "react";

type Props = {
  count?: number;
};

// Ambient floating hearts behind the home screen. Purely decorative, GPU-friendly
// (CSS transform/opacity keyframes), and disabled by the existing reduced-motion
// media query in global.css.
export default function FloatingHearts({ count = 10 }: Props) {
  const hearts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: 12 + Math.random() * 16,
        delay: Math.random() * 12,
        duration: 9 + Math.random() * 9,
        opacity: 0.18 + Math.random() * 0.25,
      })),
    [count]
  );

  return (
    <div className="floating-hearts" aria-hidden>
      {hearts.map((h) => (
        <span
          key={h.id}
          className="floating-heart"
          style={{
            left: `${h.left}%`,
            fontSize: h.size,
            opacity: h.opacity,
            animationDelay: `${h.delay}s`,
            animationDuration: `${h.duration}s`,
          }}
        >
          ♥
        </span>
      ))}
    </div>
  );
}
