import Link from "next/link";
import type { Market } from "@/lib/types";
import { compact } from "@/lib/format";
import { signed } from "@/lib/visual";
import Bonding from "./Bonding";

/** A market as a glass card — used wherever a table would be too heavy. */
export default function MarketCard({ market }: { market: Market }) {
  const up = market.change24h >= 0;
  return (
    <Link
      href={`/token/${market.mint}`}
      className="glass glass-hover tap block p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="market-letter-avatar" aria-hidden="true">
            {market.ticker.slice(0, 2)}
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="mono truncate text-sm font-semibold">
              {market.ticker}
            </span>
            <span className="truncate text-xs text-muted">{market.name}</span>
          </div>
        </div>
        <span className="chip mono shrink-0">{market.commoditySymbol}</span>
      </div>

      <div className="mt-3.5 flex items-end justify-between gap-2">
        <div className="flex flex-col">
          <span className="eyebrow">Market cap</span>
          <span className="mono text-xl font-semibold">
            {compact(market.fdvUsd)}
          </span>
        </div>
        <span
          className={`mono text-[13px] ${up ? "text-positive" : "text-negative"}`}
        >
          {signed(market.change24h, 1)}%
        </span>
      </div>

      <div className="mt-3">
        <Bonding
          pct={market.curveProgressPct}
          migrated={market.migrated}
          width={120}
        />
      </div>
    </Link>
  );
}
