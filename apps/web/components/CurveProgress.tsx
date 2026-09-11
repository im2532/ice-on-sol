export default function CurveProgress({ pct, migrated }: { pct: number; migrated?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={migrated ? "Bonding curve complete, migrated" : `Bonding curve ${Math.round(clamped)}% filled`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface2"
    >
      <div
        className={`h-full rounded-full ${migrated ? "bg-icemarkets-gradient" : "bg-green"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
