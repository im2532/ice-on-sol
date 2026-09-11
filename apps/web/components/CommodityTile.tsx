import Link from "next/link";
import type { CommodityQuote } from "@/lib/types";
import { fmtPriceUsd } from "@/lib/format";
import { signed, swatch } from "@/lib/visual";
import StatusPill from "./StatusPill";

interface CommodityTileProps {
  commodity: CommodityQuote;
  /** Small corner pill, e.g. "Index". */
  badge?: string;
  /** Link target; null renders a non-interactive tile (an index coin not seeded on this cluster yet). */
  href?: string | null;
  /** Replaces the "N markets" line. */
  footer?: string;
}

/** One commodity coin on /commodities: mono ticker, name, price, 24h, markets count, status. */
export default function CommodityTile({ commodity, badge, href, footer }: CommodityTileProps) {
  const target = href === undefined ? `/commodities/${commodity.symbol}` : href;
  const flat = Math.abs(commodity.change24h) < 0.005;

  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="h-8 w-8 shrink-0 rounded-[10px]"
            style={{ background: swatch(commodity.symbol) }}
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="mono text-[13px] font-semibold">{commodity.symbol}</span>
            <span className="truncate text-[11px] text-muted">{commodity.displayName ?? commodity.name}</span>
          </span>
        </span>
        {badge && <span className="chip shrink-0 text-[10px]" style={{ height: 20 }}>{badge}</span>}
      </span>

      <span className="mt-3 flex items-end justify-between gap-2">
        <span className="flex flex-col">
          <span className="mono text-[15px] font-semibold">
            {fmtPriceUsd(commodity.priceUsd)}
          </span>
          <span className="mono text-[11px] text-muted">/ {commodity.unitShort}</span>
        </span>
        <span className={`mono text-[12px] ${flat ? "text-muted" : commodity.change24h > 0 ? "text-positive" : "text-negative"}`}>
          {signed(commodity.change24h)}%
        </span>
      </span>

      <span className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
        <span className="mono text-[11px] text-muted">
          {footer ?? `${commodity.marketsCount.toLocaleString("en-US")} markets`}
        </span>
        <StatusPill status={commodity.status} className="shrink-0 text-[10px]" />
      </span>
    </>
  );

  const cls = "glass tap flex flex-col p-3.5 sm:p-4";
  if (target === null) return <div className={`${cls} opacity-70`}>{body}</div>;
  return (
    <Link href={target} className={`${cls} glass-hover`}>
      {body}
    </Link>
  );
}
