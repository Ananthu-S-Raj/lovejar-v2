import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import AdminCard from "../../components/admin/AdminCard";
import StatusPill from "../../components/admin/StatusPill";
import FormStatus from "../../components/admin/FormStatus";
import SectionTabs from "../../components/admin/SectionTabs";
import { useConfirm } from "../../components/admin/ConfirmDialog";
import { timeAgo, fmtTime, PET_STAGE_EMOJI } from "./utils";
import type { UserProfile, ResetRequest, UserActivity, UserLoginHistory, Nickname } from "./types";

type Tab = "Profile" | "Login" | "Nicknames" | "PIN & Security" | "Activity";

export default function AdminUser() {
  const [tab, setTab] = useState<Tab>("Profile");

  return (
    <div className="page admin-page">
      <h2 className="admin-title">User</h2>
      <p className="admin-subtitle">The person you share LoveJar with — their account, access and activity.</p>
      <SectionTabs tabs={["Profile", "Login", "Nicknames", "PIN & Security", "Activity"]} active={tab} onChange={(t) => setTab(t as Tab)} />
      {tab === "Profile" && <ProfileTab />}
      {tab === "Login" && <LoginTab />}
      {tab === "Nicknames" && <NicknamesTab />}
      {tab === "PIN & Security" && <PinTab />}
      {tab === "Activity" && <ActivityTab />}
    </div>
  );
}

function ProfileTab() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api.get<UserProfile>("/admin/user/profile").then(setProfile).catch(() => setError("Couldn't load the profile."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!profile) return <p className="loading">Loading…</p>;

  return (
    <>
      <AdminCard title={profile.userNickname} subtitle={profile.name}>
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Login</span>
            <span className="admin-row-value">
              <StatusPill status={profile.loginEnabled} label={profile.loginEnabled ? "Enabled" : "Disabled"} />
            </span>
          </div>
          {!profile.loginEnabled && profile.disableReason && (
            <div className="admin-row">
              <span className="admin-row-label">Disable reason</span>
              <span className="admin-row-value">{profile.disableReason}</span>
            </div>
          )}
          <div className="admin-row">
            <span className="admin-row-label">Last activity</span>
            <span className="admin-row-value">{timeAgo(profile.lastActivity)}</span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Day streak</span>
            <span className="admin-row-value">
              {profile.streak.currentStreak} 🔥 (longest {profile.streak.longestStreak})
            </span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Pet</span>
            <span className="admin-row-value">
              {PET_STAGE_EMOJI[profile.pet.stage] ?? "🐾"} {profile.pet.stage} · happiness {profile.pet.happiness}%
            </span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Notifications</span>
            <span className="admin-row-value">
              {profile.notificationsUnread} unread in-app · {profile.sessions.count} active session{profile.sessions.count === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </AdminCard>
      <AdminCard title="Names" subtitle="How each of you is addressed">
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">User calls you</span>
            <span className="admin-row-value">{profile.adminNickname}</span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">You call the user</span>
            <span className="admin-row-value">{profile.userNickname}</span>
          </div>
        </div>
      </AdminCard>
    </>
  );
}

function LoginTab() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ask, dialog } = useConfirm();

  function load() {
    api.get<UserProfile>("/admin/user/profile").then((p) => {
      setProfile(p);
      setReason(p.disableReason ?? "");
    });
  }
  useEffect(load, []);

  async function toggle() {
    if (!profile) return;
    const disabling = profile.loginEnabled;
    if (disabling) {
      const ok = await ask({
        title: "Disable user login?",
        message: "The user won't be able to sign in until you re-enable it. They'll see the reason you provide.",
        confirmLabel: "Disable login",
      });
      if (!ok) return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await api.post("/admin/user/disable-login", { disabled: disabling, reason: disabling ? reason : undefined });
      load();
      setStatus({ tone: "success", text: disabling ? "Login disabled." : "Login re-enabled." });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return <p className="loading">Loading…</p>;

  return (
    <>
      <AdminCard
        title="User login access"
        subtitle="Pause the user's access whenever you need a break — their streak is untouched."
      >
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Status</span>
            <span className="admin-row-value">
              <StatusPill status={profile.loginEnabled} label={profile.loginEnabled ? "Login enabled" : "Login disabled"} />
            </span>
          </div>
        </div>
        {profile.loginEnabled ? (
          <>
            <label htmlFor="disable-reason">Reason shown to the user</label>
            <textarea
              id="disable-reason"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Taking a short break — back soon 💕"
              rows={2}
            />
            <button onClick={toggle} disabled={busy} className="btn-danger">
              {busy ? "Working…" : "Disable login"}
            </button>
          </>
        ) : (
          <button onClick={toggle} disabled={busy}>
            {busy ? "Working…" : "Re-enable login"}
          </button>
        )}
        {status && <FormStatus tone={status.tone}>{status.text}</FormStatus>}
      </AdminCard>
      {dialog}
    </>
  );
}

function NicknamesTab() {
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [user, setUser] = useState("");
  const [admin, setAdmin] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ask, dialog } = useConfirm();

  function load() {
    api.get<{ nicknames: Nickname[] }>("/admin/nicknames").then((r) => {
      const map: Record<string, string> = {};
      for (const n of r.nicknames) map[n.role] = n.nickname;
      setNicknames(map);
      setUser(map["user"] ?? "");
      setAdmin(map["admin"] ?? "");
    });
  }
  useEffect(load, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      if (user.trim()) await api.post("/admin/nicknames", { forRole: "user", nickname: user.trim() });
      if (admin.trim()) await api.post("/admin/nicknames", { forRole: "admin", nickname: admin.trim() });
      load();
      setStatus({ tone: "success", text: "Nicknames saved." });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  async function reset(role: "user" | "admin") {
    const ok = await ask({
      title: `Reset ${role} nickname?`,
      message: `"${nicknames[role] ?? "—"}" will be cleared and the default name used again.`,
      confirmLabel: "Reset nickname",
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/nicknames/${role}`);
      load();
      setStatus({ tone: "success", text: "Nickname reset." });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  return (
    <>
      <AdminCard title="Nicknames" subtitle="What each of you calls the other across the app.">
        <label htmlFor="nickname-user">What the user calls you (admin)</label>
        <input id="nickname-user" value={admin} maxLength={50} onChange={(e) => setAdmin(e.target.value)} placeholder="Admin" />
        <label htmlFor="nickname-admin">What you call the user</label>
        <input id="nickname-admin" value={user} maxLength={50} onChange={(e) => setUser(e.target.value)} />
        <div className="admin-btn-row">
          <button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save nicknames"}
          </button>
          <button className="btn-secondary" onClick={() => reset("user")} disabled={!nicknames["user"]}>
            Reset user nickname
          </button>
          <button className="btn-secondary" onClick={() => reset("admin")} disabled={!nicknames["admin"]}>
            Reset admin nickname
          </button>
        </div>
        {status && <FormStatus tone={status.tone}>{status.text}</FormStatus>}
      </AdminCard>
      {dialog}
    </>
  );
}

function PinTab() {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { ask, dialog } = useConfirm();

  function load() {
    api.get<{ requests: ResetRequest[] }>("/admin/reset-requests").then((r) => setRequests(r.requests));
  }
  useEffect(load, []);

  async function saveNewPin() {
    if (!/^\d{6}$/.test(pin)) return;
    const ok = await ask({
      title: "Set a new user PIN?",
      message: "It applies immediately and the user's other sessions are signed out. They'll need the new PIN to sign in.",
      confirmLabel: "Set PIN",
    });
    if (!ok) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.post<{ message: string }>("/admin/user/set-pin", { pin });
      setPin("");
      load();
      setStatus({ tone: "success", text: res.message ?? "New PIN saved and active." });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  async function approve(r: ResetRequest) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.post<{ message: string }>(`/admin/reset-requests/${r.id}/approve`);
      load();
      setStatus({ tone: "success", text: res.message ?? "Reset approved." });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "Couldn't approve." });
    } finally {
      setBusy(false);
    }
  }

  async function deny(r: ResetRequest) {
    await api.post(`/admin/reset-requests/${r.id}/deny`);
    load();
  }

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <>
      <AdminCard
        title="Pending PIN reset requests"
        subtitle="The user asked for a new PIN. Approve to apply the PIN they chose, or deny it."
      >
        {pending.length === 0 && <p className="subtle-text">None pending.</p>}
        {pending.map((r) => (
          <div key={r.id} className="admin-request">
            <div>
              <p className="admin-request-title">
                Request #{r.id} · {timeAgo(r.created_at)}
              </p>
              {r.reason && <p className="subtle-text">{r.reason}</p>}
            </div>
            <div className="admin-btn-row">
              <button className="btn-danger" onClick={() => approve(r)} disabled={busy}>
                Approve
              </button>
              <button className="btn-secondary" onClick={() => deny(r)} disabled={busy}>
                Deny
              </button>
            </div>
          </div>
        ))}
      </AdminCard>

      <AdminCard title="Set a new user PIN" subtitle="Applied immediately — no redeploy, no secrets to set.">
        <label htmlFor="new-pin">New 6-digit PIN</label>
        <input
          id="new-pin"
          inputMode="numeric"
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="••••••"
        />
        <button onClick={saveNewPin} disabled={busy || !/^\d{6}$/.test(pin)}>
          {busy ? "Saving…" : "Save new PIN"}
        </button>
      </AdminCard>

      {status && <FormStatus tone={status.tone}>{status.text}</FormStatus>}
      {dialog}
    </>
  );
}

function ActivityTab() {
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [history, setHistory] = useState<UserLoginHistory | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function load() {
    setError(null);
    api.get<UserActivity>("/admin/user/activity").then(setActivity).catch(() => setError("Couldn't load activity."));
    api.get<UserLoginHistory>("/admin/user/login-history").then(setHistory).catch(() => setError("Couldn't load login history."));
  }
  useEffect(load, []);
  if (error) return <p className="error-text">{error}</p>;
  if (!activity || !history) return <p className="loading">Loading…</p>;

  const s = history.summary;

  async function loadMore() {
    const cursor = history?.nextBefore;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.get<UserLoginHistory>(`/admin/user/login-history?before=${cursor}`);
      setHistory((prev) =>
        prev
          ? { ...next, attempts: [...prev.attempts, ...next.attempts], nextBefore: next.nextBefore }
          : next
      );
    } catch {
      // keep current page; the button stays available to retry
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <AdminCard title="User login security" subtitle="The user's own login history and current protection state.">
        <div className="admin-rows">
          <div className="admin-row">
            <span className="admin-row-label">Status</span>
            <span className="admin-row-value">
              <StatusPill status={!s.blocked} label={s.blocked ? "Blocked" : "Normal"} />
            </span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Last successful login</span>
            <span className="admin-row-value">{s.lastSuccess ? timeAgo(s.lastSuccess) : "Never"}</span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Failed attempts (24h)</span>
            <span className="admin-row-value">{s.failed24h}</span>
          </div>
          <div className="admin-row">
            <span className="admin-row-label">Protection window</span>
            <span className="admin-row-value">
              {s.failedInWindow}/{s.maxFailures} failed · {Math.round(s.windowSeconds / 60)} min · {s.locked} blocked
            </span>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="User login history" subtitle="Every login attempt for the user. Credentials are never shown.">
        {history.attempts.length === 0 ? (
          <p className="subtle-text">No login attempts yet.</p>
        ) : (
          <ul className="admin-list">
            {[...history.attempts].reverse().map((a) => (
              <li key={a.id} className="admin-list-item">
                <div className="login-history-line">
                  <span className={"login-icon " + (a.success === 1 ? "ok" : a.reason === "locked" ? "lock" : "fail")}>
                    {a.success === 1 ? "✓" : a.reason === "locked" ? "🔒" : "✕"}
                  </span>
                  <span className="admin-list-title">
                    {a.success === 1 ? "Successful login" : a.reason === "locked" ? "Rate limit triggered" : "Failed PIN"}
                  </span>
                </div>
                <span className="admin-list-meta">{fmtTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {history.nextBefore && (
          <button onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </AdminCard>

      <AdminCard title="Recent sign-in attempts" subtitle="Successful and failed logins for both roles.">
        {activity.attempts.length === 0 ? (
          <p className="subtle-text">No attempts recorded yet.</p>
        ) : (
          <ul className="admin-list">
            {activity.attempts.map((a, i) => (
              <li key={i} className="admin-list-item">
                <StatusPill status={a.success === 1} label={a.success === 1 ? "Success" : "Failed"} />
                <span className="admin-list-meta">
                  {a.role} · {fmtTime(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard title="Active sessions" subtitle="Session tokens are never shown — only counts and times.">
        {activity.sessions.length === 0 ? (
          <p className="subtle-text">No sessions.</p>
        ) : (
          <ul className="admin-list">
            {activity.sessions.map((s, i) => (
              <li key={i} className="admin-list-item">
                <span className="admin-list-title">{s.role} session</span>
                <span className="admin-list-meta">
                  started {fmtTime(s.created_at)} · expires {fmtTime(s.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}
