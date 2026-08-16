import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { userLoginErrorMessage } from "../lib/loginMessages";
import { sounds, haptic } from "../lib/feedback";

// Re-authentication gate shown when a user-role session exists but the app was
// freshly loaded (or the PWA was relaunched). The PIN is re-verified against
// the server (POST /auth/user/login), so the gate is server-backed — nothing is
// stored client-side and the existing secure session is left intact.
export default function ReAuthGate() {
  const { refresh, unlock } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [disabledReason, setDisabledReason] = useState("Login is currently disabled.");

  // If the admin disabled the user login while a session existed, unlocking
  // here would just fail with 423. Surface the locked state (and watch for
  // re-enable) so the user isn't stuck on an unexplained error.
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .get<{ enabled: boolean; reason: string }>("/auth/user/status")
        .then((s) => {
          if (cancelled) return;
          setDisabled(!s.enabled);
          setDisabledReason(s.reason);
        })
        .catch(() => undefined);
    check();
    const t = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length !== 6) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/user/login", { pin });
      sounds.success();
      haptic.medium();
      await refresh();
      unlock();
    } catch (err) {
      haptic.error();
      sounds.error();
      const payload = err instanceof ApiError ? err.payload : null;
      if (payload?.code === "login_disabled") {
        setDisabled(true);
        setDisabledReason(payload.reason ?? "Login is currently disabled.");
      }
      setError(userLoginErrorMessage(payload));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="brand">LoveJar</h1>
        {disabled ? (
          <div className="auth-blocked">
            <p className="auth-blocked-icon" aria-hidden>
              🔒
            </p>
            <p className="auth-blocked-title">Login is currently disabled</p>
            <p className="auth-blocked-reason">{disabledReason}</p>
            <p className="auth-blocked-hint">
              This screen refreshes automatically — it'll unlock on its own when login is turned back on.
            </p>
          </div>
        ) : (
          <>
            <p className="re-auth-hint">Welcome back — enter your secret to unlock 💝</p>
            <form onSubmit={handleUnlock} className="auth-form">
              <label>Enter your 6-digit secret</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                autoFocus
              />
              {error && <p className="error-text">{error}</p>}
              <button type="submit" disabled={pin.length !== 6 || submitting}>
                {submitting ? "Unlocking…" : "Unlock"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
