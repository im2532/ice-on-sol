import Link from "next/link";
import type { CommodityQuote } from "@/lib/types";
import { fmtPriceUsd } from "@/lib/format";
import { signed } from "@/lib/visual";
import StatusPill from "./StatusPill";
import CommodityLogo from "./CommodityLogo";

interface CommodityTileProps {
  commodity: CommodityQuote;
  badge?: string;
  href?: string | null;
  footer?: string;
}
export default function CommodityTile({
  commodity: c,
  badge,
  href,
  footer,
}: CommodityTileProps) {
  const target = href === undefined ? `/commodities/${c.symbol}` : href;
  const body = (
    <>
      <div className="commodity-tile-heading">
        <CommodityLogo symbol={c.symbol} size={40} />
        <div className="commodity-tile-name min-w-0">
          <h3>{c.displayName ?? c.name}</h3>
          <small>
            {c.symbol}
            {badge ? ` · ${badge}` : ""}
          </small>
        </div>
        <span className={`commodity-change text-xs ${c.change24h >= 0 ? "text-positive" : "text-negative"}`}>
          {signed(c.change24h)}%
        </span>
      </div>
      <div className="commodity-price-line mt-5">
        <span className="commodity-price">{fmtPriceUsd(c.priceUsd)}</span>
        <span className="text-xs text-muted">/ {c.unitShort}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        <span className="text-xs text-muted">
          {footer ?? `${c.marketsCount.toLocaleString("en-US")} markets`}
        </span>
        <StatusPill status={c.status} className="text-[10px]" />
      </div>
    </>
  );
  return target === null ? (
    <div className="glass commodity-tile ice-capped opacity-70">{body}</div>
  ) : (
    <Link href={target} className="glass glass-hover commodity-tile ice-capped">
      {body}
    </Link>
  );
}
