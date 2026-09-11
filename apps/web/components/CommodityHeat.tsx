"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CATEGORY_LABEL } from "@icemarkets/registry";
import type { Category } from "@icemarkets/registry";
import type { CommodityQuote } from "@/lib/types";
import { heatBackground, signed } from "@/lib/visual";
import { fmtPrice } from "@/lib/format";
import CommodityLogo from "./CommodityLogo";

const CATEGORY_ORDER: Category[] = [
  "metals",
  "energy",
  "agriculture",
  "livestock",
  "fast_food",
  "cs2_skins",
  "game_gold",
  "trading_cards",
  "water",
  "cars",
  "watches",
];

const VISIBLE_CHIPS = 6;
const TILE_COUNT = 13;
/** The two busiest commodities (GLD, HG) get a wider tile — size reads as "markets paired". */
const BIG_TILES = 2;

/**
 * "Commodities · 24h" — a treemap-ish grid. Tile colour is the 24h move, tile span is how many
 * markets are paired with it, so the busiest commodities read first.
 */
export default function CommodityHeat({ commodities }: { commodities: CommodityQuote[] | undefined }) {
  const [category, setCategory] = useState<Category | "all">("all");
  const [showAllChips, setShowAllChips] = useState(false);

  const present = useMemo(() => {
    if (!commodities) return [] as Category[];
    return CATEGORY_ORDER.filter((c) => commodities.some((a) => a.category === c));
  }, [commodities]);

  const tiles = useMemo(() => {
    if (!commodities) return [];
    const pool = category === "all" ? commodities : commodities.filter((a) => a.category === category);
    return pool
      .slice()
      .sort((a, b) => b.marketsCount - a.marketsCount || Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, TILE_COUNT);
  }, [commodities, category]);

  const chips = showAllChips ? present : present.slice(0, VISIBLE_CHIPS);
  const hidden = present.length - chips.length;

  return (
    <section className="glass flex flex-col gap-3.5 p-4 sm:p-5" aria-labelledby="commodity-heat-heading">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="commodity-heat-heading" className="display text-base font-semibold">
            Commodities · 24h
          </h2>
          <p className="text-xs text-muted">24h move · tile size by markets paired</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter commodities by category">
          <button
            type="button"
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
            className={`chip tap ${category === "all" ? "chip-on" : ""}`}
          >
            All
          </button>
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`chip tap ${category === c ? "chip-on" : ""}`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
          {hidden > 0 && (
            <button type="button" onClick={() => setShowAllChips(true)} className="chip tap text-muted">
              +{hidden}
            </button>
          )}
        </div>
      </div>

      {tiles.length === 0 ? (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 sm:gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="tile h-[64px] animate-pulse bg-white/[0.04] sm:h-[104px]" />
          ))}
        </div>
      ) : (
        <div
          className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 sm:gap-2"
          style={{ gridAutoRows: "minmax(64px, auto)" }}
        >
          {tiles.map((c, i) => {
            const big = i < BIG_TILES;
            const up = c.change24h > 0;
            const flat = Math.abs(c.change24h) < 0.005;
            return (
              <Link
                key={c.symbol}
                href={`/commodities/${c.symbol}`}
                className={`tile tap gap-2 sm:min-h-[104px] ${big ? "col-span-2" : ""} ${i === 0 ? "sm:row-span-2" : ""}`}
                style={{ background: heatBackground(c.change24h) }}
                aria-label={`${c.symbol}, ${c.displayName ?? c.name}, ${signed(c.change24h)} percent in 24 hours`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <CommodityLogo symbol={c.symbol} size={big ? 28 : 24} />
                    <span
                      className="mono font-semibold"
                      style={{ fontSize: 11, letterSpacing: "-0.01em" }}
                    >
                      {c.symbol}
                    </span>
                  </span>
                  {big && (
                    <span
                      className={`mono text-[11px] sm:text-xs ${flat ? "text-muted" : up ? "text-positive" : "text-negative"}`}
                    >
                      {signed(c.change24h)}%
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className={`mono font-semibold ${big ? "text-base sm:text-[18px]" : "text-[13px] sm:text-[15px]"}`}>
                    {fmtPrice(c.priceUsd)}
                  </span>
                  {big ? (
                    <span className="hidden truncate text-xs text-muted sm:block">
                      {c.displayName ?? c.name} · {c.marketsCount} markets
                    </span>
                  ) : (
                    <span
                      className={`mono text-[11px] ${flat ? "text-muted" : up ? "text-positive" : "text-negative"}`}
                    >
                      {signed(c.change24h)}%
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
