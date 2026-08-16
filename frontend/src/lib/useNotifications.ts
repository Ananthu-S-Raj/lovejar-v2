import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { onNotificationRefresh } from "./notificationBus";

export type NotificationItem = {
  id: number;
  type: string;
  title: string;
  body: string;
  reference_id: number | null;
  read_at: number | null;
  created_at: number;
};

type FetchResult = {
  notifications: NotificationItem[];
  unreadCount: number;
};

// Loads the current role's notification feed. Refreshes:
//   - every POLL_MS while the app is visible,
//   - when the tab regains focus (visibilitychange),
//   - immediately when something else in the app knows a notification landed
//     (notificationBus, e.g. a chat WebSocket message).
const POLL_MS = 45_000;

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async (silent = true) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await api.get<FetchResult>("/notifications");
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      if (!silent) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const off = onNotificationRefresh(() => void refresh(true));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      off();
    };
  }, [refresh]);

  const markRead = useCallback(async (id: number) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? Date.now() / 1000 } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      // optimistic; refetch will reconcile
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? Date.now() / 1000 })));
    setUnreadCount(0);
    try {
      await api.post("/notifications/read-all");
    } catch {
      // optimistic; refetch will reconcile
    }
  }, []);

  return { notifications, unreadCount, refresh, markRead, markAllRead };
}
