// Minimal cross-component bus so the notification center can be told to refresh
// the moment a relevant event is known to have happened (e.g. a new chat
// message arrived over the WebSocket). Kept dependency-free on purpose.

type Listener = () => void;

const listeners = new Set<Listener>();

export function onNotificationRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitNotificationRefresh() {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // a broken listener must never break the bus
    }
  }
}
