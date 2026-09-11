import { curveLabel } from "@/lib/visual";

/** Bonding-curve fill: a 90px gradient bar plus "72%" / "Graduated". */
export default function Bonding({
  pct,
  migrated = false,
  width = 90,
}: {
  pct: number;
  migrated?: boolean;
  width?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const graduated = migrated || clamped >= 100;
  const label = curveLabel(clamped, migrated);
  return (
    <span className="flex items-center gap-2">
      <span
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={graduated ? "Graduated" : `${Math.round(clamped)} percent of the bonding curve filled`}
        className="block h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
        style={{ width }}
      >
        <span
          className="block h-full rounded-full bg-ice-gradient"
          style={{ width: `${graduated ? 100 : clamped}%` }}
        />
      </span>
      <span className={`mono text-[11px] ${graduated ? "text-positive" : "text-muted"}`}>{label}</span>
    </span>
  );
}
