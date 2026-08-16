type Tone = "ok" | "warn" | "error" | "neutral";

type Props = {
  status: Tone | boolean;
  label: string;
};

export default function StatusPill({ status, label }: Props) {
  const tone: Tone = typeof status === "boolean" ? (status ? "ok" : "error") : status;
  return (
    <span className={`status-pill status-${tone}`} title={label}>
      <span className="status-dot" aria-hidden />
      {label}
    </span>
  );
}
