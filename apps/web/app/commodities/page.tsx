"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCommodities } from "@/lib/api";
import { CATEGORY_LABEL } from "@icemarkets/registry";
import type { Category } from "@icemarkets/registry";
import CommodityCard from "@/components/CommodityCard";

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
];

export default function CommoditiesPage() {
  const { data, isLoading } = useQuery({ queryKey: ["commodities"], queryFn: fetchCommodities });
  const [tokenizeQuery, setTokenizeQuery] = useState("");

  const byCategory = useMemo(() => {
    const map = new Map<Category, typeof data>();
    if (!data) return map;
    for (const cat of CATEGORY_ORDER) map.set(cat, data.filter((c) => c.category === cat) as typeof data);
    return map;
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Commodities</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {data ? data.length : "…"} coins a market can be paired with, each pegged to a live oracle
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
