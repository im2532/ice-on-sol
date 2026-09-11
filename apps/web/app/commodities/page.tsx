"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCommodities } from "@/lib/api";
import { CATEGORY_LABEL, INDEX_COINS } from "@icemarkets/registry";
import type { Category } from "@icemarkets/registry";
import type { CommodityQuote } from "@/lib/types";
import CommodityCard from "@/components/CommodityCard";

const INDEX_SYMBOLS = new Set(INDEX_COINS.map((c) => c.symbol));

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

export default function CommoditiesPage() {
  const { data, isLoading } = useQuery({ queryKey: ["commodities"], queryFn: fetchCommodities });
  const [tokenizeQuery, setTokenizeQuery] = useState("");

  const byCategory = useMemo(() => {
    const map = new Map<Category, CommodityQuote[]>();
    if (!data) return map;
    for (const cat of CATEGORY_ORDER) map.set(cat, data.filter((c) => c.category === cat && !INDEX_SYMBOLS.has(c.symbol)));
    return map;
  }, [data]);

  // Index coins (Composite): the indexer's quote when seeded on this cluster, otherwise a
  // registry placeholder priced from its legs (not clickable until seeded).
  const indexCoins = useMemo(() => {
    if (!data) return [];
    return INDEX_COINS.map((ic) => {
      const quote = data.find((q) => q.symbol === ic.symbol);
      if (quote) return { quote, seeded: true, legs: ic.oracle.legs ?? [] };
      const legs = ic.oracle.legs ?? [];
      const priceUsd = legs.reduce((acc, l) => acc + ((data.find((q) => q.symbol === l.symbol)?.priceUsd ?? 0) * l.weightBps) / 10_000, 0);
      const placeholder: CommodityQuote = {
        symbol: ic.symbol,
        name: ic.name,
        displayName: ic.displayName,
        category: ic.category,
        emoji: ic.emoji,
        unit: ic.unit,
        unitShort: ic.unitShort,
        priceUsd,
        change24h: 0,
        marketsCount: 0,
        status: "closed",
        lastPublishedAgoSec: 0,
        supplyCap: 0,
        supplyOutstanding: 0,
        reserveRatioBps: 10_000,
        mint: "",
      };
      return { quote: placeholder, seeded: false, legs };
    });
  }, [data]);
  const coinCount = data ? data.filter((c) => !INDEX_SYMBOLS.has(c.symbol)).length : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Commodities</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {coinCount ?? "…"} coins a market can be paired with, each pegged to a live oracle
            price. Click one to see its chart and trade it for USDC.
          </p>
        </div>
        <Link href="/launch" className="icemarkets-btn-primary icemarkets-focus shrink-0 px-5 py-2.5 text-sm">
          Launch a market
        </Link>
      </div>

      <div className="icemarkets-card mt-6 p-5">
        <h2 className="text-sm font-semibold">Tokenize anything</h2>
        <p className="mt-1 max-w-xl text-sm text-muted">
          Every product on TCGplayer, screened for depth. Deep enough markets become a coin and pair with
          any launch — coming in v2.
        </p>
        <div className="group relative mt-3">
          <input
            disabled
            value={tokenizeQuery}
            onChange={(e) => setTokenizeQuery(e.target.value)}
            placeholder="Search anything: Charizard, Black Lotus, One Piece booster box…"
            aria-describedby="tokenize-tooltip"
            className="w-full cursor-not-allowed rounded-lg border border-border bg-surface2 px-4 py-2.5 text-sm text-muted placeholder:text-muted/70"
          />
          <span
            id="tokenize-tooltip"
            role="tooltip"
            className="pointer-events-none absolute left-4 top-full mt-1.5 rounded-md border border-border bg-surface2 px-2.5 py-1 text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100"
          >
            Coming in v2
          </span>
        </div>
      </div>

      {isLoading && (
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="icemarkets-card h-36 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && indexCoins.length > 0 && (
        <section className="mt-10" aria-labelledby="index-coins-heading">
          <div className="mb-3 flex items-center gap-2">
            <h2 id="index-coins-heading" className="text-xs font-semibold uppercase tracking-wider text-muted">
              Index coins
            </h2>
          </div>
          <p className="mb-3 max-w-2xl text-xs text-muted">
            Baskets priced as the weighted sum of their legs&apos; oracle prices. Pair a launch with one like any other coin.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {indexCoins.map(({ quote, seeded, legs }) => (
              <CommodityCard
                key={quote.symbol}
                commodity={quote}
                badge="Index"
                href={seeded ? undefined : null}
                footer={seeded ? `${quote.marketsCount} markets · ${legs.length} legs` : `${legs.map((l) => l.symbol).join(" · ")}`}
              />
            ))}
          </div>
        </section>
      )}

      {!isLoading &&
        CATEGORY_ORDER.map((cat) => {
          const items = byCategory.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <section key={cat} className="mt-10">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                {CATEGORY_LABEL[cat]}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {items.map((c) => (
                  <CommodityCard key={c.symbol} commodity={c} />
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
