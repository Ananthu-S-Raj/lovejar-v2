import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { sounds, haptic } from "../lib/feedback";

const MAX_SCORE = 25;
const GAME_DURATION_MS = 25_000;

type Heart = { x: number; y: number; speed: number; caught?: boolean };

// Subtle urgency styling as the clock runs down: calm through the first part,
// warning in the last 9 seconds, urgent in the final 4.
function timerPhase(playing: boolean, remaining: number): string {
  if (!playing || remaining > 9) return "calm";
  if (remaining <= 4) return "urgent";
  return "warn";
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(Math.round(GAME_DURATION_MS / 1000));
  const [confirmExit, setConfirmExit] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const stateRef = useRef({ hearts: [] as Heart[], basketX: 150, running: false, score: 0, spawnEvery: 900 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasEl = canvas;
    const ctx = canvasEl.getContext("2d")!;
    let animationFrame: number;
    let lastSpawn = 0;
    let startTime = 0;
    let lastRemaining = Math.round(GAME_DURATION_MS / 1000);

    function draw(ts: number) {
      const s = stateRef.current;
      if (!s.running) return;
      if (!startTime) startTime = ts;
      const elapsed = ts - startTime;

      if (elapsed > GAME_DURATION_MS) {
        endGame();
        return;
      }

      // gradually increase difficulty by spawning faster and falling quicker
      s.spawnEvery = Math.max(350, 900 - elapsed / 60);
      if (ts - lastSpawn > s.spawnEvery) {
        lastSpawn = ts;
        s.hearts.push({ x: Math.random() * (canvasEl.width - 24), y: -24, speed: 1.5 + elapsed / 8000 });
      }

      // update the visible countdown only when the second actually changes
      const secs = Math.max(0, Math.ceil((GAME_DURATION_MS - elapsed) / 1000));
      if (secs !== lastRemaining) {
        lastRemaining = secs;
        setRemaining(secs);
      }

      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      // basket
      ctx.font = "36px serif";
      ctx.fillText("🧺", s.basketX - 18, canvasEl.height - 10);

      s.hearts.forEach((h) => {
        h.y += h.speed;
        ctx.font = "26px serif";
        ctx.fillText("❤️", h.x, h.y);
      });

      // collision + cleanup
      s.hearts = s.hearts.filter((h) => {
        const caught = h.y > canvasEl.height - 50 && h.y < canvasEl.height - 5 && Math.abs(h.x - s.basketX) < 30;
        if (caught) {
          s.score = Math.min(MAX_SCORE, s.score + 1);
          setScore(s.score);
          sounds.success();
          haptic.light();
          return false;
        }
        return h.y < canvasEl.height + 30;
      });

      animationFrame = requestAnimationFrame(draw);
    }

    function endGame() {
      stateRef.current.running = false;
      setPlaying(false);
      setRemaining(0);
      if (stateRef.current.score >= 10) haptic.strong();
      submitScore(stateRef.current.score);
    }

    function handleMove(clientX: number) {
      const rect = canvasEl.getBoundingClientRect();
      stateRef.current.basketX = Math.max(20, Math.min(canvasEl.width - 20, clientX - rect.left));
    }
    const mouseHandler = (e: MouseEvent) => handleMove(e.clientX);
    const touchHandler = (e: TouchEvent) => handleMove(e.touches[0].clientX);
    canvasEl.addEventListener("mousemove", mouseHandler);
    canvasEl.addEventListener("touchmove", touchHandler);

    if (playing) {
      stateRef.current = { hearts: [], basketX: canvasEl.width / 2, running: true, score: 0, spawnEvery: 900 };
      setScore(0);
      setResultMessage(null);
      setRemaining(Math.round(GAME_DURATION_MS / 1000));
      animationFrame = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      canvasEl.removeEventListener("mousemove", mouseHandler);
      canvasEl.removeEventListener("touchmove", touchHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Escape closes the exit confirmation.
  useEffect(() => {
    if (!confirmExit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmExit(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmExit]);

  async function submitScore(finalScore: number) {
    try {
      const res = await api.post<{ message: string }>("/game/score", { score: finalScore });
      setResultMessage(res.message);
    } catch {
      setResultMessage("Great round! (Couldn't save your score right now.)");
    }
  }

  // Leaving mid-round stops the loop and discards the score — no submission.
  function exitGame() {
    setConfirmExit(false);
    stateRef.current.running = false;
    setScore(0);
    setResultMessage(null);
    setRemaining(Math.round(GAME_DURATION_MS / 1000));
    setPlaying(false);
  }

  return (
    <div className="page game-page">
      <div className="game-header">
        <h2>Heart Catch</h2>
        {playing && (
          <button
            type="button"
            className="game-exit"
            aria-label="Exit game"
            onClick={() => {
              haptic.light();
              setConfirmExit(true);
            }}
          >
            ✕
          </button>
        )}
      </div>
      <p className="subtle">Catch as many hearts as you can in 25 seconds. Max score: {MAX_SCORE}.</p>
      <p className="score-tag">
        <span className={"game-timer " + timerPhase(playing, remaining)} aria-live="polite" aria-label={`${remaining} seconds remaining`}>
          <span className="game-timer-icon">⏱</span>
          <span className="game-timer-num">{remaining}</span>
        </span>
        <span className="score-num">Score: {score}</span>
      </p>
      <canvas ref={canvasRef} width={320} height={420} className="game-canvas" />
      {!playing && (
        <button
          className="primary-btn"
          onClick={() => {
            setPlaying(true);
            sounds.tap();
            haptic.light();
          }}
        >
          {resultMessage ? "Play Again" : "Start Game"}
        </button>
      )}
      {resultMessage && <p className="jar-message-text">{resultMessage}</p>}

      {confirmExit && (
        <div className="game-exit-backdrop" onClick={() => setConfirmExit(false)}>
          <div
            className="game-exit-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="game-exit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="game-exit-title" id="game-exit-title">
              Exit the game?
            </p>
            <p className="subtle">Your score won't be saved.</p>
            <div className="game-exit-actions">
              <button type="button" className="ghost-btn" autoFocus onClick={() => setConfirmExit(false)}>
                Cancel
              </button>
              <button type="button" className="danger-btn" onClick={exitGame}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
