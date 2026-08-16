import { useEffect, useRef, useState } from "react";
import { sounds, vibrate } from "../lib/feedback";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "lovejar-pwa-install-dismissed-at";
const REASK_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

type PromptMode = "android" | "ios" | null;

function isIOS() {
  const ua = navigator.userAgent;
  const ipadOnIOS13 = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || ipadOnIOS13;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function shouldAsk() {
  try {
    const last = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - last >= REASK_AFTER_MS;
  } catch {
    return true;
  }
}

export default function PWAInstallPrompt() {
  const [mode, setMode] = useState<PromptMode>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const sessionDismissed = useRef(false);

  useEffect(() => {
    if (isStandalone()) return;

    const canAsk = shouldAsk();

    const handlePrompt = (e: Event) => {
      e.preventDefault();
      if (!canAsk || sessionDismissed.current) return;
      sessionDismissed.current = true;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setMode("android");
    };

    const handleInstalled = () => {
      setHidden(true);
      setDeferredPrompt(null);
    };

    if (isIOS()) {
      if (canAsk && !sessionDismissed.current) {
        sessionDismissed.current = true;
        setMode("ios");
      }
    } else {
      window.addEventListener("beforeinstallprompt", handlePrompt);
    }
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const dismiss = () => {
    sessionDismissed.current = true;
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore storage errors (private mode etc.)
    }
  };

  const install = async () => {
    sounds.tap();
    vibrate(15);
    if (!deferredPrompt) return;
    const prompt = deferredPrompt;
    setDeferredPrompt(null);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        setHidden(true);
      } else {
        dismiss();
      }
    } catch {
      dismiss();
    }
  };

  if (hidden || !mode) return null;

  return (
    <aside className="pwa-prompt" role="status" aria-live="polite">
      <span className="pwa-prompt-icon">💖</span>
      <div className="pwa-prompt-copy">
        {mode === "ios" ? (
          <>
            <strong>Install Love Jar</strong>
            <span>Tap Share, then “Add to Home Screen”.</span>
          </>
        ) : (
          <>
            <strong>Install Love Jar</strong>
            <span>Keep us close — faster to open.</span>
          </>
        )}
      </div>
      {mode === "ios" ? (
        <button className="pwa-prompt-note" onClick={dismiss}>
          OK
        </button>
      ) : (
        <button className="pwa-prompt-install" onClick={install}>
          Install
        </button>
      )}
      <button className="pwa-prompt-dismiss" aria-label="Dismiss" onClick={dismiss}>
        ✕
      </button>
    </aside>
  );
}
