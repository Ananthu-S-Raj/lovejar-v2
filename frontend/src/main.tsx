import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./lib/AuthContext";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import ErrorBoundary from "./components/ErrorBoundary";
import ToastProvider from "./components/ToastProvider";
import "./styles/global.css";
import "./styles/admin.css";

// Global error safety nets ------------------------------------------------
// 1) Stale-chunk self-heal: if a hard reload ever asks for a hashed chunk the
//    server no longer has (a deploy race), the dynamic import fails and the
//    page would render blank. The real fix is the SW serving fresh index.html
//    (NetworkFirst) so the shell and chunks always match — this is a guarded
//    last resort that recovers the app instead of leaving a white screen.
// 2) Unhandled promise rejections are logged so regressions are visible in the
//    console instead of silently eating failures.

const SELF_HEAL_KEY = "lj_self_heal_ts";
const SELF_HEAL_COOLDOWN_MS = 60_000;

function isStaleChunkError(message: string): boolean {
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /ChunkLoadError/i.test(message)
  );
}

function selfHealFromStaleChunk() {
  const last = Number(sessionStorage.getItem(SELF_HEAL_KEY) || 0);
  if (Date.now() - last < SELF_HEAL_COOLDOWN_MS) return;
  sessionStorage.setItem(SELF_HEAL_KEY, String(Date.now()));
  // Ask the service worker to pick up the newest build first so the reload
  // boots against the current shell instead of a stale one.
  navigator.serviceWorker
    ?.getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.update())))
    .catch(() => undefined)
    .finally(() => window.location.reload());
}

window.addEventListener("error", (event) => {
  if (event.message && isStaleChunkError(event.message)) {
    selfHealFromStaleChunk();
    return;
  }
  console.error("LoveJar window error:", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  const message =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "unknown rejection";
  if (typeof message === "string" && isStaleChunkError(message)) {
    selfHealFromStaleChunk();
    return;
  }
  console.error("LoveJar unhandled rejection:", reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ToastProvider>
        <PWAInstallPrompt />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
