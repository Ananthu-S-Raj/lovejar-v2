import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api, setUnauthorizedHandler } from "./api";

type Role = "user" | "admin" | null;

type AuthState = {
  role: Role;
  loading: boolean;
  authReady: boolean;
  unlocked: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  unlock: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  // Re-authentication gate: on each fresh app load the user must enter their
  // PIN again even though a valid server session still exists. This is state
  // only (never a stored secret), so it resets on every page load / PWA
  // relaunch. The PIN check itself is a real server-backed login.
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler((isAdminRoute) => {
      setRole(null);
      setUnlocked(false);
      const target = isAdminRoute ? "/admin/login" : "/login";
      if (location.pathname !== target) navigate(target, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, location.pathname]);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ authenticated: boolean; role?: Role }>("/auth/me");
      setRole(me.authenticated ? (me.role as Role) : null);
      // Authentication is now restored and ready
      setAuthReady(true);
    } catch {
      setRole(null);
      setAuthReady(true); // Even failed restoration is complete
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setRole(null);
    setUnlocked(false);
    setAuthReady(true);
  }, []);

  const unlock = useCallback(() => setUnlocked(true), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ role, loading, authReady, unlocked, refresh, logout, unlock }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
