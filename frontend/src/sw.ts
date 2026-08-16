/// <reference lib="webworker" />
// LoveJar service worker.
//   - App-shell navigations are fetched fresh (NetworkFirst) so the HTML never
//     goes stale after a deploy. Serving the precached index.html for every
//     navigation is what caused the "white screen on refresh": a cached shell
//     references hashed chunks that were already deleted from the server (and
//     cleaned out of the precache), so the app boots to an empty page.
//   - Precache the built app shell so the PWA installs and works offline.
//   - CacheFirst for static assets (icons, fonts, hashed assets).
//   - Receives Web Push notifications (admin only — the user's notifications
//     are in-app; see Admin → Settings → Notifications) and opens the app on tap.
// skipWaiting + clientsClaim preserve the existing "autoUpdate" behaviour:
// a new service worker activates as soon as it finishes installing.
import { precache, precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { skipWaiting, clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope;

skipWaiting();
clientsClaim();

// ---- App shell -----------------------------------------------------------
// `precache()` populates the precache map and installs the shell WITHOUT
// registering a routing route (that's what `precacheAndRoute()` adds).
// `createHandlerBoundToURL` needs the precache map populated, so it must run
// after `precache()`. The navigation route is registered NEXT so it is checked
// before every other route — the precache's directoryIndex entry (registered
// below by `precacheAndRoute`) can never intercept a navigation again.
// NetworkFirst means a reload always fetches the current index.html from the
// network, so the shell and its hashed chunk URLs always belong to the same
// build. Offline, it falls back to the fresh pages cache, then to the precached
// shell as a last resort.
const manifest = self.__WB_MANIFEST;
precache(manifest);

const navigationHandler = new NetworkFirst({
  cacheName: "lovejar-pages-v1",
  networkTimeoutSeconds: 5,
  plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 })],
});
const offlineShellHandler = createHandlerBoundToURL("/index.html");
registerRoute(
  new NavigationRoute(async (context) => {
    try {
      return await navigationHandler.handle(context);
    } catch {
      return offlineShellHandler(context);
    }
  })
);

precacheAndRoute(manifest);
cleanupOutdatedCaches();

registerRoute(
  ({ url }) =>
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/assets/"),
  new CacheFirst({ cacheName: "lovejar-static-v1" })
);

type PushPayload = { title?: string; body?: string; type?: string };

self.addEventListener("push", (event) => {
  let data: PushPayload | null = null;
  try {
    const parsed = event.data?.json();
    data = parsed && typeof parsed === "object" ? (parsed as PushPayload) : null;
  } catch {
    // non-JSON payload — ignore
  }
  const title = data?.title ?? "LoveJar";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data?.body ?? "You have a new notification.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data?.type ?? "lovejar",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow("/admin");
    })()
  );
});
