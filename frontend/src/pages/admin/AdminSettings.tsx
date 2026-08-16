import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/ToastProvider";

// Web Push is admin-only by design (the user's notifications are in-app only),
// so the controls for it live in Admin Settings. The service worker must be
// active and registered first (PWA install), then the browser exposes
// registration.pushManager.
function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function AdminSettings() {
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [adminPasswordOverride, setAdminPasswordOverride] = useState(false);
  const [busyAdmin, setBusyAdmin] = useState(false);
  const toast = useToast();

  const [pushSupported, setPushSupported] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushTestResult, setPushTestResult] = useState<string | null>(null);

  useEffect(() => {
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
    setPushSupported(supported);
    if (!supported) return;
    // Is the server configured? (503 when VAPID keys are missing.)
    api
      .get<{ publicKey: string }>("/push/vapid-public-key")
      .then(() => setPushConfigured(true))
      .catch(() => setPushConfigured(false));
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => setPushEnabled(!!sub));
  }, []);

  async function enablePush() {
    if (!pushConfigured) return;
    setPushBusy(true);
    setPushMessage(null);
    try {
      const { publicKey } = await api.get<{ publicKey: string }>("/push/vapid-public-key");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      const p256dh = btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const auth = btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await api.post("/push/subscribe", { endpoint: sub.endpoint, p256dh, auth });
      setPushEnabled(true);
      setPushMessage("Browser notifications enabled. You'll get a push whenever the user does something new.");
    } catch (e) {
      setPushMessage(`Couldn't enable: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setPushEnabled(false);
      setPushMessage("Browser notifications disabled.");
    } catch (e) {
      setPushMessage(`Couldn't disable: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    setPushTestResult(null);
    setPushBusy(true);
    try {
      const res = await api.post<{ ok: number; gone: number }>("/push/test");
      setPushTestResult(res.ok > 0 ? `Sent to ${res.ok} device${res.ok === 1 ? "" : "s"}.` : "Sent, but no device confirmed yet.");
    } catch (e) {
      setPushTestResult(`Test failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setPushBusy(false);
    }
  }

  function loadSecurity() {
    api
      .get<{ credentials: { adminPasswordOverride: boolean } }>("/admin/system/security")
      .then((s) => setAdminPasswordOverride(s.credentials.adminPasswordOverride))
      .catch(() => undefined);
  }
  useEffect(() => {
    loadSecurity();
  }, []);

  async function resetAdminPassword() {
    if (newAdminPassword.length < 8) return;
    if (!confirm("Set this as the new admin password? Other admin sessions will be signed out.")) return;
    setBusyAdmin(true);
    try {
      const res = await api.post<{ message: string }>("/admin/reset-admin-password", {
        password: newAdminPassword,
      });
      toast.success(res.message ?? "New password saved and active.");
      setNewAdminPassword("");
      loadSecurity();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the new password.");
    } finally {
      setBusyAdmin(false);
    }
  }

  async function revertAdminPassword() {
    if (!confirm("Revert the admin password to the default secret? Other admin sessions will be signed out.")) return;
    try {
      const res = await api.post<{ message: string }>("/admin/credentials/revert", { which: "admin" });
      toast.success(res.message ?? "Reverted the admin password.");
      loadSecurity();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revert.");
    }
  }

  return (
    <div className="page settings-page">
      <h2>Settings</h2>

      <section className="settings-section">
        <h3>Notifications</h3>
        <p className="subtle">
          Browser notifications are enabled only here for you — the user's notifications stay inside the app.
        </p>
        {!pushSupported ? (
          <p className="subtle">This browser doesn't support push notifications.</p>
        ) : !pushConfigured ? (
          <p className="subtle">
            Push is not configured on the server (VAPID keys missing). Run <code>node scripts/gen-vapid.mjs</code> and
            add the keys, then reload.
          </p>
        ) : pushEnabled ? (
          <button onClick={disablePush} disabled={pushBusy}>
            {pushBusy ? "Working…" : "Disable browser notifications"}
          </button>
        ) : (
          <button onClick={enablePush} disabled={pushBusy}>
            {pushBusy ? "Working…" : "Enable browser notifications"}
          </button>
        )}
        {pushMessage && <p className="subtle">{pushMessage}</p>}
        {pushEnabled && (
          <button onClick={testPush} disabled={pushBusy}>
            {pushBusy ? "Working…" : "Send a test notification"}
          </button>
        )}
        {pushTestResult && <p className="subtle">{pushTestResult}</p>}
      </section>

      <section className="settings-section">
        <h3>Admin password</h3>
        <p className="subtle">
          Your own sign-in credential. Changing it applies immediately and signs out your other sessions (this one stays
          open). The user's PIN lives under User → PIN &amp; Security.
        </p>
        <label>Reset admin password (applies immediately)</label>
        <input
          type="password"
          value={newAdminPassword}
          maxLength={200}
          onChange={(e) => setNewAdminPassword(e.target.value)}
          placeholder="New admin password (min 8 chars)"
        />
        <button onClick={resetAdminPassword} disabled={busyAdmin || newAdminPassword.length < 8}>
          {busyAdmin ? "Saving…" : "Save new password"}
        </button>
        {adminPasswordOverride && (
          <p className="subtle">
            Admin password currently uses a live override.{" "}
            <button className="link-btn" onClick={revertAdminPassword}>
              Revert to default
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
