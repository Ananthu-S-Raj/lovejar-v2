import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { sounds, haptic } from "../lib/feedback";
import IconButton from "../components/IconButton";

type Event = { id: number; title: string; description: string | null; event_date: string; event_time: string | null };

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function dayLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-CA"); // YYYY-MM-DD local
  const tomorrow = new Date(today.getTime() + 86400000).toLocaleDateString("en-CA");
  if (dateStr === todayStr) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  return formatDay(dateStr);
}

// The app is IST-anchored (jar resets at IST midnight), so "today" for alerts
// follows the same clock the backend uses, not the device's local timezone.
function istTodayStr(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function Calendar() {
  const [events, setEvents] = useState<Event[]>([]);
  const [upcoming, setUpcoming] = useState<Event[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .get<{ events: Event[]; upcoming: Event[] }>("/calendar")
      .then((r) => {
        setEvents(r.events);
        setUpcoming(r.upcoming);
      })
      .catch(() => setError("Couldn't load the calendar."));
  }
  useEffect(load, []);

  function resetForm() {
    setTitle("");
    setDate("");
    setTime("");
    setDescription("");
    setEditingId(null);
  }

  async function submit() {
    if (!title.trim() || !date) return;
    setError(null);
    try {
      if (editingId !== null) {
        await api.patch(`/calendar/${editingId}`, {
          title: title.trim(),
          description: description || undefined,
          eventDate: date,
          eventTime: time || undefined,
        });
      } else {
        await api.post("/calendar", {
          title: title.trim(),
          description: description || undefined,
          eventDate: date,
          eventTime: time || undefined,
        });
      }
      sounds.success();
      haptic.light();
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the event.");
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this event?")) return;
    setError(null);
    try {
      await api.delete(`/calendar/${id}`);
      haptic.light();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the event.");
    }
  }

  function startEdit(e: Event) {
    setEditingId(e.id);
    setTitle(e.title);
    setDate(e.event_date);
    setTime(e.event_time ?? "");
    setDescription(e.description ?? "");
    haptic.light();
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of events) {
      const list = map.get(e.event_date) ?? [];
      list.push(e);
      map.set(e.event_date, list);
    }
    return [...map.entries()];
  }, [events]);

  // In-app alerts for what's happening now and soon. Derived from the server's
  // `upcoming` list (next 7 days) and memoized, so they never fire repeatedly
  // on re-render — they're a deterministic banner, not stacked notifications.
  const { todayEvents, laterEvents } = useMemo(() => {
    const today = istTodayStr();
    const t: Event[] = [];
    const l: Event[] = [];
    for (const e of upcoming) {
      (e.event_date === today ? t : l).push(e);
    }
    return { todayEvents: t, laterEvents: l };
  }, [upcoming]);

  return (
    <div className="page">
      <h2>Calendar</h2>

      {(todayEvents.length > 0 || laterEvents.length > 0) && (
        <div className="calendar-alerts">
          {todayEvents.map((e) => (
            <div key={e.id} className="calendar-alert today">
              📅 Today: {e.title}
              {e.event_time ? ` at ${e.event_time}` : ""} ❤️
            </div>
          ))}
          {laterEvents.map((e) => (
            <div key={e.id} className="calendar-alert upcoming">
              📅 {dayLabel(e.event_date)}: {e.title}
            </div>
          ))}
        </div>
      )}

      <form
        className="event-form glass-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3>{editingId !== null ? "Edit event" : "New event"}</h3>
        <label htmlFor="ev-title">Title</label>
        <input
          id="ev-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Our anniversary dinner"
          required
        />
        <label htmlFor="ev-date">Date</label>
        <input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <label htmlFor="ev-time">Time (optional)</label>
        <input id="ev-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <label htmlFor="ev-desc">Notes (optional)</label>
        <textarea
          id="ev-desc"
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A little memory to remember it by…"
          rows={2}
        />
        <div className="row-buttons form-actions">
          <button type="submit" disabled={!title.trim() || !date}>
            {editingId !== null ? "Save changes" : "Add event"}
          </button>
          {editingId !== null && (
            <button type="button" className="ghost-btn" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="page-error">
          <p className="error-text">{error}</p>
          <button className="link-btn" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {events.length === 0 && !error && (
        <div className="calendar-empty">
          <div className="calendar-empty-art">📅</div>
          <p>No events yet — plan something special together.</p>
        </div>
      )}

      <div className="event-groups">
        {grouped.map(([day, dayEvents]) => (
          <section key={day} className="event-group">
            <h3 className="event-day">{dayLabel(day)}</h3>
            {dayEvents.map((e) => (
              <div key={e.id} className="list-item event-card">
                <div className="event-main">
                  <strong>{e.title}</strong>
                  {e.event_time && <span className="event-time">{e.event_time}</span>}
                  {e.description && <div className="subtle">{e.description}</div>}
                </div>
                <div className="event-actions">
                  <IconButton label="Edit event" onClick={() => startEdit(e)}>
                    ✏️
                  </IconButton>
                  <IconButton label="Delete event" destructive onClick={() => remove(e.id)}>
                    🗑
                  </IconButton>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
