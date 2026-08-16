import { useCallback, useEffect, useRef, useState } from "react";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

type Active = ConfirmOptions & { resolve: (value: boolean) => void };

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  onCancel,
  onConfirm,
}: Active & { onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div
        className={"confirm-dialog" + (tone === "danger" ? " confirm-danger" : "")}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title" className="confirm-title">
          {title}
        </h3>
        <p id="confirm-message" className="confirm-message">
          {message}
        </p>
        <div className="confirm-actions">
          <button type="button" ref={cancelRef} className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [active, setActive] = useState<Active | null>(null);

  const ask = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setActive({ ...options, resolve });
    });
  }, []);

  const close = useCallback(
    (value: boolean) => {
      active?.resolve(value);
      setActive(null);
    },
    [active]
  );

  const dialog = active ? (
    <ConfirmDialog
      {...active}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;

  return { ask, dialog };
}
