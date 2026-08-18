import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

/**
 * Captures the browser's beforeinstallprompt event on /admin routes and shows
 * a custom installation prompt for the separate Admin PWA.  The manifest link
 * in index.html is swapped early (before React) so the browser evaluates the
 * admin manifest; this component also swaps it defensively on mount.
 *
 * Only renders when:
 *   1. The current path starts with /admin
 *   2. The app is NOT already running in standalone mode
 *   3. The browser has fired beforeinstallprompt
 */
export default function AdminPWAInstallPrompt() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/admin")) return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true;
    if (isStandalone) return;

    // Defensive: swap manifest on mount in case the inline script in index.html
    // didn't execute before the browser's installability check.
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]'
    );
    if (link && !link.href.includes("admin-manifest")) {
      link.setAttribute("href", "/admin-manifest.webmanifest");
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      // Brief delay so the admin page is visible before the prompt appears.
      setTimeout(() => setShowPrompt(true), 700);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function installAdmin() {
    if (!installEvent) return;
    await installEvent.prompt();
    const result = await installEvent.userChoice;
    if (result.outcome === "accepted") setShowPrompt(false);
    setInstallEvent(null);
  }

  if (!showPrompt || !installEvent) return null;

  return (
    <div className="admin-install-backdrop">
      <div className="admin-install-card">
        <div className="admin-install-icon">⚙️</div>
        <div className="admin-install-content">
          <h2>Install LoveJar Admin</h2>
          <p>
            Install the Admin Control Center as a separate app for quick,
            dedicated access.
          </p>
          <div className="admin-install-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowPrompt(false)}
            >
              Not now
            </button>
            <button
              type="button"
              className="admin-install-btn"
              onClick={installAdmin}
            >
              Install Admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
