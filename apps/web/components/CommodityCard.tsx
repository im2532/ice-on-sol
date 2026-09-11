import Link from "next/link";
import type { CommodityQuote } from "@/lib/types";
import { pct, pctClass, usd } from "@/lib/format";

export default function CommodityCard({ commodity }: { commodity: CommodityQuote }) {
  return (
    <Link
      href={`/commodities/${commodity.symbol}`}
      className="icemarkets-card icemarkets-focus block p-4 text-center transition-colors hover:border-green/40"
    >
      <div className="text-2xl" aria-hidden="true">
        {commodity.emoji}
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{commodity.displayName ?? commodity.name}</div>
      <div className="mt-1 font-nums text-base">
        {usd(commodity.priceUsd, { decimals: commodity.priceUsd < 1 ? 4 : 2 })}
        <span className="text-xs text-muted">/{commodity.unitShort}</span>
      </div>
      <div className={`mt-0.5 font-nums text-xs ${pctClass(commodity.change24h)}`}>{pct(commodity.change24h)}</div>
      <div className="mt-1.5 text-[11px] text-muted">{commodity.marketsCount} markets</div>
    </Link>
  );
}
