const SEGMENTS = [
  { label: "Holders", pct: 40, className: "bg-positive" },
  { label: "$ICE burn", pct: 20, className: "bg-purple" },
  { label: "Protocol", pct: 20, className: "bg-muted" },
  { label: "Meteora", pct: 20, className: "bg-border" },
];

export default function FeeSplitBar() {
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" role="img" aria-label="Fee split: 40% holders, 20% ICEmarkets burn, 20% protocol, 20% Meteora">
        {SEGMENTS.map((s) => (
          <div key={s.label} className={s.className} style={{ width: `${s.pct}%` }} title={`${s.label} ${s.pct}%`} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
        {SEGMENTS.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-sm ${s.className}`} aria-hidden="true" />
            {s.pct}% {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
