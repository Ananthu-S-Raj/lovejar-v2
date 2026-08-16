import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import AdminCard from "../../components/admin/AdminCard";
import StatusPill from "../../components/admin/StatusPill";
import SectionTabs from "../../components/admin/SectionTabs";
import { fmtTime, timeAgo } from "./utils";
import type { HealthCheck, SystemSecurity, SystemConfiguration, AdminAction } from "./types";

type Tab = "Health" | "Security" | "Configuration" | "Audit" | "PWA";

export default function AdminSystem() {
  const [tab, setTab] = useState<Tab>("Health");
  return (
    <div className="page admin-page">
      <h2 className="admin-title">System</h2>
      <p className="admin-subtitle">The machinery underneath — health, security, configuration and history.</p>
      <SectionTabs tabs={["Health", "Security", "Configuration", "Audit", "PWA"]} active={tab} onChange={(t) => setTab(t as Tab)} />
      {tab === "Health" && <HealthTab />}
      {tab === "Security" && <SecurityTab />}
      {tab === "Configuration" && <ConfigTab />}
      {tab === "Audit" && <AuditTab />}
      {tab === "PWA" && <PwaTab />}
    </div>
  );
}

type MonitoringEndpoint = { path: string; method: string; auth: string; okStatus: number; description: string };

function HealthTab() {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [monitoring, setMonitoring] = useState<{ endpoints: MonitoringEndpoint[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api
      .get<{ checks: HealthCheck[] }>("/admin/system/health")
      .then((r) => setChecks(r.checks))
      .catch(() => setError("Couldn't run health checks."));
    api
      .get<{ endpoints: MonitoringEndpoint[]; note: string }>("/admin/system/monitoring")
      .then(setMonitoring)
      .catch(() => setMonitoring(null));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!checks) return <p className="loading">Loading…</p>;

  return (
    <>
      <AdminCard title="Health checks" subtitle="Live status of every service the app touches.">
        <ul className="admin-list">
          {checks.map((c) => (
            <li key={c.key} className="admin-list-item">
              <StatusPill status={c.status} label={c.label} />
              <span className="admin-list-detail">{c.detail}</span>
            </li>
          ))}
        </ul>
        <p className="subtle-text">
          A warning means the feature degrades gracefully (fallback bank, no weather, no push). An error means the core is
          down.
        </p>
      </AdminCard>

      <AdminCard
        title="Uptime monitoring"
        subtitle="Where external monitors (UptimeRobot, Better Uptime, Cronitor, …) point. Registered manually — no provider keys are stored in LoveJar."
      >
        {monitoring ? (
          <>
            <ul className="admin-list">
              {monitoring.endpoints.map((e) => (
                <li key={e.path} className="admin-list-item">
                  <span className="admin-list-title mono-text">
                    {e.method} {e.path}
                  </span>
                  <span className="admin-list-detail">{e.description}</span>
                  <span className="admin-list-meta">
                    {e.auth} · HTTP {e.okStatus} = up
                  </span>
                </li>
              ))}
            </ul>
            <p className="subtle-text">{monitoring.note}</p>
          </>
        ) : (
          <p className="subtle-text">Monitoring info unavailable.</p>
        )}
      </AdminCard>
    </>
  );
}

function SecurityTab() {
  const [sec, setSec] = useState<SystemSecurity | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api.get<SystemSecurity>("/admin/system/security").then(setSec).catch(() => setError("Couldn't load security."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!sec) return <p className="loading">Loading…</p>;

  return (
    <>
      <AdminCard
        title="Access"
        actions={<StatusPill status={sec.loginEnabled} label={sec.loginEnabled ? "User login on" : "User login off"} />}
      >
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Sessions</span>
            <span className="admin-row-value">
              {sec.sessions.user} user · {sec.sessions.admin} admin (last admin login {timeAgo(sec.sessions.lastAdminLoginAt)})
            </span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Pending PIN requests</span>
            <span className="admin-row-value">{sec.pendingPinRequests}</span>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Brute-force protection" subtitle="Per-role lockout after repeated failed attempts.">
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Policy</span>
            <span className="admin-row-value">
              {sec.rateLimit.maxFailures} failures / {sec.rateLimit.windowSeconds / 60} min
            </span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Last 24h</span>
            <span className="admin-row-value">
              {sec.rateLimit.failedUserLast24h} failed user · {sec.rateLimit.failedAdminLast24h} failed admin
            </span>
          </div>
        </div>
      </AdminCard>

      <AdminCard
        title="Web Push"
        actions={<StatusPill status={sec.push.configured} label={sec.push.configured ? "Configured" : "Not configured"} />}
      >
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Subscriptions</span>
            <span className="admin-row-value">{sec.push.subscriptions}</span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Last seen</span>
            <span className="admin-row-value">{timeAgo(sec.push.lastSeenAt)}</span>
          </div>
        </div>
      </AdminCard>
    </>
  );
}

function ConfigTab() {
  const [config, setConfig] = useState<SystemConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api.get<SystemConfiguration>("/admin/system/configuration").then(setConfig).catch(() => setError("Couldn't load configuration."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!config) return <p className="loading">Loading…</p>;

  return (
    <AdminCard title="Configuration" subtitle="Non-secret values the worker runs with. Hashes and keys are never shown.">
      <div className="admin-rows">
        <div className="admin-row">
          <span className="admin-row-label">App</span>
          <span className="admin-row-value">{config.appName}</span>
        </div>
        <div className="admin-row">
          <span className="admin-row-label">User name</span>
          <span className="admin-row-value">{config.userName}</span>
        </div>
        <div className="admin-row">
          <span className="admin-row-label">Admin email</span>
          <span className="admin-row-value">{config.adminEmail}</span>
        </div>
        <div className="admin-row">
          <span className="admin-row-label">Timezone</span>
          <span className="admin-row-value">{config.timezone.label}</span>
        </div>
        <div className="admin-row">
          <span className="admin-row-label">AI (Gemini)</span>
          <span className="admin-row-value">{config.aiConfigured ? "Configured" : "Fallback bank"}</span>
        </div>
        <div className="admin-row">
          <span className="admin-row-label">Weather</span>
          <span className="admin-row-value">{config.weatherConfigured ? "Configured" : "Not configured"}</span>
        </div>
        <div className="admin-row">
          <span className="admin-row-label">Web Push</span>
          <span className="admin-row-value">{config.pushConfigured ? "Configured" : "Not configured"}</span>
        </div>
      </div>
    </AdminCard>
  );
}

function AuditTab() {
  const [actions, setActions] = useState<AdminAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api.get<{ actions: AdminAction[] }>("/admin/activity").then((r) => setActions(r.actions)).catch(() => setError("Couldn't load the audit log."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!actions) return <p className="loading">Loading…</p>;

  return (
    <AdminCard title="Audit log" subtitle="The last 50 admin actions. Details only — never secrets.">
      {actions.length === 0 ? (
        <p className="subtle-text">No actions recorded yet. They'll appear as you use the controls.</p>
      ) : (
        <ul className="admin-list">
          {actions.map((a, i) => (
            <li key={i} className="admin-list-item">
              <span className="admin-list-title mono-text">{a.action}</span>
              <span className="admin-list-detail">{a.detail}</span>
              <span className="admin-list-meta">{fmtTime(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}

function PwaTab() {
  const [info, setInfo] = useState<{ sw: boolean; standalone: boolean; storage: string | null }>({
    sw: false,
    standalone: false,
    storage: null,
  });

  useEffect(() => {
    let mounted = true;
    const swActive = "serviceWorker" in navigator ? navigator.serviceWorker.controller !== null : false;
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    const update = (storage: string | null) => {
      if (mounted) setInfo({ sw: swActive, standalone, storage });
    };
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        const mb = est.usage != null ? (est.usage / (1024 * 1024)).toFixed(1) : null;
        update(mb ? `${mb} MB` : null);
      });
    } else {
      update(null);
    }
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <AdminCard
        title="PWA status"
        subtitle="This is a client-side look at how the app is installed on this device."
        actions={<StatusPill status={info.standalone} label={info.standalone ? "Installed" : "In browser"} />}
      >
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Service worker</span>
            <span className="admin-row-value">{info.sw ? "Controlling this page" : "Not active on this load"}</span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Storage used</span>
            <span className="admin-row-value">{info.storage ?? "unknown"}</span>
          </div>
        </div>
      </AdminCard>
      <AdminCard title="Installing the app">
        <p className="subtle-text">
          On phones: use the browser's "Add to Home screen". On desktop: use the install icon in the address bar.
          LoveJar caches its shell so it opens instantly and works offline.
        </p>
      </AdminCard>
    </>
  );
}
