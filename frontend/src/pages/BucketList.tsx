import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { sounds, haptic } from "../lib/feedback";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/admin/ConfirmDialog";

type Item = { id: number; title: string; description: string | null; completed: number; created_by: string };

export default function BucketList() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { ask, dialog } = useConfirm();

  function load() {
    setError(null);
    api
      .get<{ items: Item[] }>("/bucket-list")
      .then((r) => setItems(r.items))
      .catch(() => setError("Couldn't load the bucket list."));
  }
  useEffect(load, []);

  async function add(e?: FormEvent) {
    e?.preventDefault();
    const goal = title.trim();
    if (!goal) {
      toast.error("Give your goal a name first.");
      return;
    }
    if (isAdding) return;
    setIsAdding(true);
    setError(null);
    try {
      await api.post("/bucket-list", { title: goal, description });
      setTitle("");
      setDescription("");
      sounds.tap();
      haptic.light();
      toast.success("Added to the bucket list ✨");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the goal.");
      toast.error("Couldn't add the goal.");
    } finally {
      setIsAdding(false);
    }
  }

  async function toggle(item: Item) {
    setError(null);
    try {
      await api.patch(`/bucket-list/${item.id}`, { completed: !item.completed });
      if (!item.completed) {
        sounds.success();
        haptic.medium();
        toast.success("Marked as achieved!");
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the goal.");
      toast.error("Couldn't update the goal.");
    }
  }

  async function remove(id: number) {
    const ok = await ask({
      title: "Remove this goal?",
      message: "Remove this goal from your bucket list?",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setError(null);
    try {
      await api.delete(`/bucket-list/${id}`);
      haptic.light();
      toast.info("Goal removed.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the goal.");
      toast.error("Couldn't remove the goal.");
    }
  }

  const done = items.filter((i) => i.completed);
  const pending = items.filter((i) => !i.completed);

  return (
    <div className="page">
      <h2>Bucket List</h2>
      <p className="subtle">
        {done.length} of {items.length} completed together
      </p>

      <form className="add-row" onSubmit={add}>
        <input
          placeholder="New goal…"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="New goal"
        />
        <input
          placeholder="Details (optional)"
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Details (optional)"
        />
        <button type="submit" disabled={isAdding || !title.trim()}>
          Add
        </button>
      </form>

      {error && (
        <div className="page-error">
          <p className="error-text">{error}</p>
          <button className="link-btn" onClick={load}>
            Retry
          </button>
        </div>
      )}

      <div className="list">
        {items.length === 0 && !error && (
          <p className="subtle">No goals yet — add your first dream together ✨</p>
        )}        {pending.map((i) => (
          <div key={i.id} className="list-item">
            <button
              type="button"
              className="achieved-toggle"
              onClick={() => toggle(i)}
              aria-label={`Mark "${i.title}" as achieved`}
              aria-pressed={false}
            />
            <button type="button" className="list-item-body" onClick={() => toggle(i)}>
              <strong>{i.title}</strong>
              {i.description && <div className="subtle">{i.description}</div>}
            </button>
          </div>
        ))}
        {done.length > 0 && <h4>Completed</h4>}
        {done.map((i) => (
          <div key={i.id} className="list-item done">
            <button
              type="button"
              className="achieved-toggle achieved"
              onClick={() => toggle(i)}
              aria-label={`Mark "${i.title}" as not achieved`}
              aria-pressed={true}
            >
              ✓
            </button>
            <button type="button" className="list-item-body" onClick={() => toggle(i)}>
              <strong className="strikethrough">{i.title}</strong>
              {i.description && <div className="subtle">{i.description}</div>}
            </button>
            <button className="list-item-remove" onClick={() => remove(i.id)} aria-label={`Remove "${i.title}"`}>
              ✕
            </button>
          </div>
        ))}
      </div>
      {dialog}
    </div>
  );
}
