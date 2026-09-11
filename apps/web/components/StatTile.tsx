interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}

export default function StatTile({ label, value, sub, valueClassName = "" }: StatTileProps) {
  return (
    <div className="icemarkets-card px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 font-nums text-xl font-semibold sm:text-2xl ${valueClassName}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
