import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { api } from "./api";

// Application-level online presence. The app shell (any page — Home, Bucket,
// Pet, …) heartbeats an authenticated endpoint so "online" means "the app is
// open", not "the chat page is open".
//
// It also doubles as a cheap session-liveness probe: when the admin changes the
// user's PIN or disables login, the server revokes the user's session, the next
// heartbeat 401s, and the central api.ts handler signs the user out right away
// (no manual refresh, no waiting for the notification poll).
//
// Heartbeats pause while the tab is hidden (the server marks the role offline
// after a short grace period) and resume immediately when it regains focus or
// the route changes.
const HEARTBEAT_MS = 20_000;

export function usePresence() {
  const location = useLocation();

  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      api
        .post("/chat/presence")
        .then(() => undefined)
        .catch(() => undefined);
    };

    beat();
    const id = window.setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [location.pathname]);
}
