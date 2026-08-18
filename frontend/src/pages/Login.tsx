import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { userLoginErrorMessage, adminLoginErrorMessage } from "../lib/loginMessages";
import { sounds, haptic } from "../lib/feedback";

export default function Login() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");
  const navigate = useNavigate();
  const { refresh, unlock } = useAuth();

  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userStatus, setUserStatus] = useState<{ enabled: boolean; reason: string } | null>(null);

  // Watch the public user-login status while the login screen is open, so a
  // disabled login shows a clear locked state and unlocks live when the admin
  // re-enables it — no hard refresh needed.
  useEffect(() => {
    if (isAdmin) return;
    let cancelled = false;
    const check = () =>
      api
        .get<{ enabled: boolean; reason: string }>("/auth/user/status")
        .then((s) => {
          if (!cancelled) setUserStatus(s);
        })
        .catch(() => {
          // Status endpoint unreachable (offline): don't lock the form behind
          // it — a login attempt surfaces the real error if login is disabled.
          if (!cancelled) setUserStatus((prev) => prev ?? { enabled: true, reason: "" });
        });
    check();
    const t = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isAdmin]);

  function retryStatus() {
    api
      .get<{ enabled: boolean; reason: string }>("/auth/user/status")
      .then(setUserStatus)
      .catch(() => undefined);
  }

  async function handleUserLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/user/login", { pin });
      sounds.success();
      haptic.medium();
      await refresh();
      unlock();
      navigate("/", { replace: true });
    } catch (err) {
      haptic.error();
      sounds.error();
      const payload = err instanceof ApiError ? err.payload : null;
      if (payload?.code === "login_disabled") {
        setUserStatus({ enabled: false, reason: payload.reason ?? "Login is currently disabled." });
      }
      setError(userLoginErrorMessage(payload));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/admin/login", { email, password });
      sounds.success();
      haptic.medium();
      await refresh();
      navigate("/admin", { replace: true });
    } catch (err) {
      haptic.error();
      sounds.error();
      const payload = err instanceof ApiError ? err.payload : null;
      setError(adminLoginErrorMessage(payload));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await api.post<{ message: string }>("/auth/user/forgot-password", { newPin });
      setForgotMsg(res.message);
    } catch (err) {
      setForgotMsg(err instanceof ApiError ? err.message : "Could not send reset request.");
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="brand">LoveJar {isAdmin ? "· Admin" : ""}</h1>

        {!isAdmin && !showForgot && userStatus && !userStatus.enabled && (
          <div className="auth-blocked">
            <p className="auth-blocked-icon" aria-hidden>
              🔒
            </p>
            <p className="auth-blocked-title">Login is currently disabled</p>
            <p className="auth-blocked-reason">{userStatus.reason}</p>
            <p className="auth-blocked-hint">
              This screen refreshes automatically — it'll unlock on its own when login is turned back on.
            </p>
            <button type="button" className="auth-blocked-retry" onClick={retryStatus}>
              Try again
            </button>
          </div>
        )}

        {!isAdmin && !showForgot && (!userStatus || userStatus.enabled) && (
          <form onSubmit={handleUserLogin} className="auth-form">
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
              {submitting ? "Opening…" : "Enter"}
            </button>
            <button type="button" className="link-btn" onClick={() => setShowForgot(true)}>
              Forgot password?
            </button>
          </form>
        )}

        {!isAdmin && showForgot && (
          <form onSubmit={handleForgot} className="auth-form">
            <label>Choose a new 6-digit PIN (needs admin approval)</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
            />
            {forgotMsg && <p className="hint-text">{forgotMsg}</p>}
            <button type="submit" disabled={newPin.length !== 6}>
              Send reset request
            </button>
            <button type="button" className="link-btn" onClick={() => setShowForgot(false)}>
              Back to login
            </button>
          </form>
        )}

        {isAdmin && (
          <form onSubmit={handleAdminLogin} className="auth-form">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p className="error-text">{error}</p>}
            <button type="submit" disabled={!email || !password || submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
