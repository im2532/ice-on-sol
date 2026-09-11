import { compact } from "@/lib/format";
import type { GlobalStats } from "@/lib/types";

/** The $ICE strip: exchange coin, paired with GLD, market cap and burn to date. */
export default function IceCard({ stats }: { stats: GlobalStats | undefined }) {
  return (
    <section className="glass flex items-center justify-between gap-3 p-4 sm:px-5" aria-label="$ICE, the exchange coin">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="h-10 w-10 shrink-0 rounded-xl bg-ice-gradient-diag"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)" }}
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-col">
          <span className="display text-[15px] font-bold">$ICE</span>
          <span className="text-xs text-muted">exchange coin · paired with GLD</span>
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="mono text-base font-semibold">{stats ? compact(stats.iceMcapUsd, { decimals: 2 }) : "—"}</span>
        <span className="mono text-[11px] text-muted">
          {stats ? `${compact(stats.iceBurned, { prefix: "" })} burned` : "—"}
        </span>
      </div>
    </section>
  );
}
