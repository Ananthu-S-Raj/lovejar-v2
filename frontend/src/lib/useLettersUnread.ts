import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { onNotificationRefresh } from "./notificationBus";

// Single source of truth for the letters unread badge. The count lives in a
// module-level cache so every badge (Home quick action, bottom nav) reads the
// same value. It uses the existing letter read/unread system (a letter is
// unread while GET /letters reports read_at == null) — no second counter.
// Refreshes on focus, on a moderate poll while visible, and whenever a
// notification refresh fires (a new chat message always creates one).

type Letter = { id: number; read_at: number | null; is_draft?: number };

let cache: number | null = null;
let fetching = false;
const listeners = new Set<() => void>();

async function fetchUnread(silent = true): Promise<number> {
  if (fetching) return cache ?? 0;
  fetching = true;
  try {
    const data = await api.get<{ letters: Letter[] }>("/letters");
    cache = data.letters.filter((l) => !l.is_draft && !l.read_at).length;
  } catch {
    if (!silent) cache = 0;
  } finally {
    fetching = false;
  }
  for (const l of [...listeners]) l();
  return cache ?? 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Lets the Letters page nudge the badge the moment the user marks a letter
// read, so the nav/quick-action badges update without waiting for a poll.
export async function refreshLettersUnread(): Promise<number> {
  return fetchUnread();
}

const POLL_MS = 45_000;

export function useLettersUnread(enabled = true) {
  const [unread, setUnread] = useState(enabled ? cache ?? 0 : 0);

  useEffect(() => {
    if (!enabled) return;
    const onChange = () => setUnread(cache ?? 0);
    const off = subscribe(onChange);
    void fetchUnread();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchUnread();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchUnread();
    };
    const offNotif = onNotificationRefresh(() => void fetchUnread());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      offNotif();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  const refresh = useCallback(() => fetchUnread(), []);

  return { unread, refresh };
}
