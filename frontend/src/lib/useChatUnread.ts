import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { onNotificationRefresh } from "./notificationBus";

// Single source of truth for the chat unread badge. The count lives in a
// module-level cache so every badge (bottom nav, admin sidebar, more sheet)
// reads the same value, and any component that knows chat changed can refresh.
// Refreshes on focus, on a poll interval, and whenever a notification refresh
// fires (a new chat message always creates one).
//
// The server computes "unread" as the peer's messages newer than this role's
// read watermark — never the caller's own messages, never merely "history
// loaded" or "socket connected".

let cache: number | null = null;
let fetching = false;
const listeners = new Set<() => void>();

async function fetchUnread(silent = true): Promise<number> {
  if (fetching) return cache ?? 0;
  fetching = true;
  try {
    const data = await api.get<{ unread: number }>("/chat/unread");
    cache = data.unread;
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

const POLL_MS = 30_000;

export function useChatUnread() {
  const [unread, setUnread] = useState(cache ?? 0);

  useEffect(() => {
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
  }, []);

  const markRead = useCallback(async () => {
    try {
      await api.post("/chat/read");
    } catch {
      // optimistic; the next poll/focus refresh reconciles
    }
    await fetchUnread();
  }, []);

  return { unread, refresh: fetchUnread, markRead };
}
