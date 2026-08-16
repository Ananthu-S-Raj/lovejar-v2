type Props = {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
};

export default function SectionTabs({ tabs, active, onChange }: Props) {
  return (
    <div className="section-tabs" role="tablist" aria-label="Sections">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={t === active}
          className={"section-tab" + (t === active ? " active" : "")}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
