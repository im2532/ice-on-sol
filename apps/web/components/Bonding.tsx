import { ProgressBar } from "@/components/agentic/ProgressBar";
import { curveLabel } from "@/lib/visual";
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
  return (
    <span className="flex items-center gap-2">
      <span
        style={
          {
            width,
            "--color-bg-success": "var(--color-content-primary)",
          } as React.CSSProperties
        }
      >
        <ProgressBar
          total={20}
          filled={Math.round((migrated ? 100 : clamped) / 5)}
          height={14}
        />
      </span>
      <span className="text-xs text-muted">
        {curveLabel(clamped, migrated)}
      </span>
    </span>
  );
}
