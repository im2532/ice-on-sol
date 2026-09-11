import Link from "next/link";
import type { CommodityQuote } from "@/lib/types";
import { pct, pctClass, usd } from "@/lib/format";

interface CommodityCardProps {
  commodity: CommodityQuote;
  /** Small pill in the corner, e.g. "Index" for index coins. */
  badge?: string;
  /** Link target; null renders a non-interactive card (e.g. an index coin not seeded on this cluster yet). */
  href?: string | null;
  /** Replaces the "N markets" footer. */
  footer?: string;
}

export default function CommodityCard({ commodity, badge, href, footer }: CommodityCardProps) {
  const target = href === undefined ? `/commodities/${commodity.symbol}` : href;
  const body = (
    <>
      {badge && (
        <span className="absolute right-2 top-2 rounded bg-surface2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          {badge}
        </span>
      )}
      <div className="text-2xl" aria-hidden="true">
        {commodity.emoji}
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{commodity.displayName ?? commodity.name}</div>
      <div className="mt-1 font-nums text-base">
        {commodity.priceUsd > 0 ? usd(commodity.priceUsd, { decimals: commodity.priceUsd < 1 ? 4 : 2 }) : "—"}
        <span className="text-xs text-muted">/{commodity.unitShort}</span>
      </div>
      <div className={`mt-0.5 font-nums text-xs ${pctClass(commodity.change24h)}`}>{pct(commodity.change24h)}</div>
      <div className="mt-1.5 text-[11px] text-muted">{footer ?? `${commodity.marketsCount} markets`}</div>
    </>
  );
  if (target === null) {
    return <div className="icemarkets-card relative block p-4 text-center opacity-80">{body}</div>;
  }
  return (
    <Link href={target} className="icemarkets-card icemarkets-focus relative block p-4 text-center transition-colors hover:border-green/40">
      {body}
    </Link>
  );
}
