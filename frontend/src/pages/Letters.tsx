import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { sounds, haptic } from "../lib/feedback";
import { refreshLettersUnread } from "../lib/useLettersUnread";

type Letter = {
  id: number;
  title: string;
  body: string;
  priority?: string;
  read_at: number | null;
  sent_at: number | null;
  is_draft?: number;
  created_at: number;
};

// User-facing labels for each priority. These are the only strings shown to the
// user — internal enum values are never displayed raw.
const PRIORITY_LABELS: Record<string, string> = {
  normal: "💌 Letter",
  important: "💗 Important",
  high: "❤️ High Priority",
  special: "✨ Special",
};

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "normal", label: "💌 Normal" },
  { value: "important", label: "💗 Important" },
  { value: "high", label: "❤️ High" },
  { value: "special", label: "✨ Special" },
];

function fmtDate(ts: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtTime(ts: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Letters() {
  const { role } = useAuth();
  const [letters, setLetters] = useState<Letter[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [open, setOpen] = useState<number | null>(null);
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .get<{ letters: Letter[] }>("/letters")
      .then((r) => setLetters(r.letters))
      .catch(() => setError("Couldn't load your letters."));
  }
  useEffect(load, []);

  // The user reads letters by opening them; a letter is "read" once it has been
  // opened. Idempotent on the server (first read time is kept) and silent here.
  async function toggleOpen(id: number) {
    const letter = letters.find((l) => l.id === id);
    if (letter && role === "user" && !letter.read_at) {
      api
        .patch(`/letters/${id}/read`)
        .then(() => refreshLettersUnread())
        .catch(() => undefined);
      setLetters((prev) => prev.map((l) => (l.id === id ? { ...l, read_at: Math.floor(Date.now() / 1000) } : l)));
    }
    setOpen(open === id ? null : id);
  }

  async function createAndSend(sendNow: boolean) {
    if (!title || !body) return;
    setError(null);
    try {
      await api.post("/letters", { title, body, sendNow, priority });
      setTitle("");
      setBody("");
      setPriority("normal");
      sounds.success();
      haptic.light();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the letter.");
    }
  }

  async function sendDraft(id: number) {
    setError(null);
    try {
      await api.post(`/letters/${id}/send`);
      haptic.light();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the letter.");
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this letter? This can't be undone.")) return;
    setError(null);
    try {
      await api.delete(`/letters/${id}`);
      haptic.light();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the letter.");
    }
  }

  return (
    <div className="page">
      <h2>Letters</h2>

      {role === "admin" && (
        <div className="letter-composer">
          <input
            placeholder="Title"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            placeholder="Write your letter…"
            value={body}
            maxLength={20000}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
          />
          <fieldset className="priority-picker">
            <legend>Priority</legend>
            <div className="priority-options">
              {PRIORITY_OPTIONS.map((p) => (
                <label
                  key={p.value}
                  className={"priority-option " + p.value + (priority === p.value ? " selected" : "")}
                >
                  <input
                    type="radio"
                    name="letter-priority"
                    value={p.value}
                    checked={priority === p.value}
                    onChange={() => setPriority(p.value)}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="row-buttons">
            <button onClick={() => createAndSend(false)}>Save draft</button>
            <button className="primary-btn" onClick={() => createAndSend(true)}>
              Send now
            </button>
          </div>
        </div>
      )}

      <div className="letter-list">
        {error && (
          <div className="page-error">
            <p className="error-text">{error}</p>
            <button className="link-btn" onClick={load}>
              Retry
            </button>
          </div>
        )}
        {role === "admin" && (
          <div className="filter-chips" role="group" aria-label="Filter letters by read status">
            {(["all", "unread", "read"] as const).map((f) => (
              <button
                key={f}
                className={"chip" + (readFilter === f ? " active" : "")}
                onClick={() => setReadFilter(f)}
              >
                {f === "all" ? "All" : f === "unread" ? "Unread" : "Read"}
              </button>
            ))}
          </div>
        )}
        {letters
          .filter((l) => {
            if (role !== "admin" || readFilter === "all") return true;
            if (l.is_draft) return true;
            return readFilter === "unread" ? !l.read_at : !!l.read_at;
          })
          .map((l) => (
            <div key={l.id} className="letter-card">
              <div className="letter-header" onClick={() => toggleOpen(l.id)}>
                <div>
                  <strong>{l.title}</strong>
                  <div className="letter-date">
                    {l.is_draft ? "Draft" : fmtDate(l.sent_at ?? l.created_at)}
                  </div>
                  <span className={"letter-priority " + (l.priority ?? "normal")}>
                    {PRIORITY_LABELS[l.priority ?? "normal"] ?? "💌 Letter"}
                  </span>
                  {role === "admin" && !l.is_draft && (
                    <span className={"letter-read-badge " + (l.read_at ? "read" : "unread")}>
                      {l.read_at ? "✓ Read · " + fmtTime(l.read_at) : "🔵 Unread"}
                    </span>
                  )}
                </div>
                {role === "admin" && l.is_draft ? <span className="tag">Draft</span> : null}
              </div>
              {open === l.id && <p className="letter-body">{l.body}</p>}
              {role === "admin" && (
                <div className="row-buttons">
                  {l.is_draft ? <button onClick={() => sendDraft(l.id)}>Send</button> : null}
                  <button onClick={() => remove(l.id)}>Delete</button>
                </div>
              )}
            </div>
          ))}
        {letters.filter((l) => {
          if (role !== "admin" || readFilter === "all") return true;
          if (l.is_draft) return true;
          return readFilter === "unread" ? !l.read_at : !!l.read_at;
        }).length === 0 && <p className="subtle">No letters yet.</p>}
      </div>
    </div>
  );
}
