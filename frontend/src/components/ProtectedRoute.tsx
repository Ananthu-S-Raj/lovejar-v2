import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/AuthContext";

export default function ProtectedRoute({ role, children }: { role: "user" | "admin"; children: ReactNode }) {
  const { role: currentRole, loading, authReady } = useAuth();
  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!authReady) return <div className="auth-loading-screen">Waiting for authentication...</div>;
  if (currentRole !== role) return <Navigate to={role === "admin" ? "/admin/login" : "/login"} replace />;
  return <>{children}</>;
}
