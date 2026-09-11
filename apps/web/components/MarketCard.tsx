import Link from "next/link";
import type { Market } from "@/lib/types";
import { compact, pct, pctClass } from "@/lib/format";
import CurveProgress from "./CurveProgress";

export default function MarketCard({ market }: { market: Market }) {
  return (
    <Link
      href={`/token/${market.mint}`}
      className="icemarkets-card icemarkets-focus block p-4 transition-colors hover:border-purple/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-lg" aria-hidden="true">
            {market.image}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-green">${market.ticker}</div>
            <div className="truncate text-xs text-muted">{market.name}</div>
          </div>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface2 px-2 py-1 text-[11px] text-muted"
          title={`Paired with ${market.commodityName}`}
        >
          <span aria-hidden="true">{market.commodityEmoji}</span>
          {market.commoditySymbol}
        </span>
      </div>

      <div className="mt-3.5 font-nums text-xl font-semibold">{compact(market.fdvUsd)}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted">FDV</div>

      <div className="mt-3">
        <CurveProgress pct={market.curveProgressPct} migrated={market.migrated} />
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-2">
          {market.migrated && (
            <span className="rounded-full bg-purple/15 px-2 py-0.5 font-medium text-purple">Migrated</span>
          )}
          <span className={`font-nums ${pctClass(market.change24h)}`}>{pct(market.change24h)}</span>
        </span>
        <span className="font-nums text-muted">24h vol {compact(market.volume24hUsd)}</span>
      </div>
    </Link>
  );
}
