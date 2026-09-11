import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ALL } from "@icemarkets/registry";
import CommodityLogo from "@/components/CommodityLogo";

export const metadata: Metadata = { title: "Commodity marks — dev" };

/**
 * Dev-only grid of every commodity mark in the registry (96 commodities + 3 index coins), for
 * eyeballing the whole set at once — new marks, palette drift, broken files. Never shipped to
 * production: 404s outside development.
 */
export default function DevLogosPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="container-x py-10">
      <div className="flex flex-col gap-2 pb-6">
        <span className="eyebrow">Dev only</span>
        <h1 className="display text-2xl font-bold">Commodity marks</h1>
        <p className="text-sm text-muted">
          {ALL.length} marks from the registry, rendered via <code className="mono">CommodityLogo</code>. A
          swatch fallback (initials on a gradient) means the SVG at{" "}
          <code className="mono">/commodities/&lt;SYMBOL&gt;.svg</code> is missing or failed to load.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {ALL.map((c) => (
          <div key={c.symbol} className="glass flex flex-col items-center gap-2 p-3 text-center">
            <CommodityLogo symbol={c.symbol} size={48} />
            <span className="flex flex-col leading-tight">
              <span className="mono text-xs font-semibold">{c.symbol}</span>
              <span className="truncate text-[11px] text-muted" style={{ maxWidth: 96 }}>
                {c.displayName ?? c.name}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
