"use client";

import { memo, useState } from "react";
import { swatch } from "@/lib/visual";

export interface CommodityLogoProps {
  /** Registry symbol — resolves to the static mark at /commodities/<symbol>.svg. */
  symbol: string;
  /**
   * Pixel size (both width and height). Guidance used across the app:
   * 32 in tables/chips, 36–40 in tiles, 48–56 in heat-grid big tiles, 72 in page headers.
   */
  size?: number;
  className?: string;
  /** Rounds the mark to a squircle at 0.28× size; false renders it square (e.g. a tight chip icon). */
  rounded?: boolean;
}

/**
 * One commodity coin's animated SVG mark, served statically from
 * `apps/web/public/commodities/<SYMBOL>.svg`. Falls back to the deterministic `swatch()` gradient
 * (first two letters of the symbol) when the file 404s — a coin without a hand-drawn mark yet, or
 * a stale/unknown symbol. Never used for a memecoin market's own image — those keep their
 * generated market swatch until real images exist.
 */
function CommodityLogoImpl({ symbol, size = 32, className, rounded = true }: CommodityLogoProps) {
  const [failed, setFailed] = useState(false);
  const radius = rounded ? Math.round(size * 0.28) : 0;

  if (failed) {
    const initials = symbol.slice(0, 2).toUpperCase();
    return (
      <div
        className={className}
        role="img"
        aria-label={symbol}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: swatch(symbol),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "rgba(5,6,11,0.72)", letterSpacing: "-0.02em" }}>
          {initials}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/commodities/${symbol}.svg`}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={className}
      style={{ borderRadius: radius, flexShrink: 0, display: "block" }}
    />
  );
}

/** `<CommodityLogo symbol size={32} className rounded?>` — see size guidance above. */
const CommodityLogo = memo(CommodityLogoImpl);
export default CommodityLogo;
