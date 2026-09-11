"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCommodities } from "@/lib/api";
import { CATEGORY_LABEL, INDEX_COINS } from "@icemarkets/registry";
import type { Category } from "@icemarkets/registry";
import type { CommodityQuote } from "@/lib/types";
import CommodityTile from "@/components/CommodityTile";

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
  const [search, setSearch] = useState("");

  const matches = useCallback(
    (c: CommodityQuote) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        c.symbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.displayName ?? "").toLowerCase().includes(q)
      );
    },
    [search]
  );

  const byCategory = useMemo(() => {
    const map = new Map<Category, CommodityQuote[]>();
    if (!data) return map;
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, data.filter((c) => c.category === cat && !INDEX_SYMBOLS.has(c.symbol) && matches(c)));
    }
    return map;
  }, [data, matches]);

  // Index coins (Composite): the indexer's quote when seeded, otherwise a registry placeholder priced
  // from its legs and left unclickable until it exists on this cluster.
  const indexCoins = useMemo(() => {
    if (!data) return [];
    return INDEX_COINS.map((ic) => {
      const quote = data.find((q) => q.symbol === ic.symbol);
      const legs = ic.oracle.legs ?? [];
      if (quote) return { quote, seeded: true, legs };
      const priceUsd = legs.reduce(
        (acc, l) => acc + ((data.find((q) => q.symbol === l.symbol)?.priceUsd ?? 0) * l.weightBps) / 10_000,
        0
      );
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
    }).filter((b) => matches(b.quote));
  }, [data, matches]);

  const count = data ? data.filter((c) => !INDEX_SYMBOLS.has(c.symbol)).length : null;

  return (
    <div className="container-x pb-16 pt-8 md:pt-12">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <span className="eyebrow">Commodities</span>
          <h1 className="display text-[32px] font-bold leading-tight text-white md:text-[44px]">
            What a market can be paired with.
          </h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-body">
            {count ?? "…"} commodity coins, each pegged to a live oracle price. Pair a market with one and
            its fees pay holders in that commodity. Open one to see its chart and trade it for USDC.
          </p>
        </div>
        <Link href="/launch" className="btn-primary tap shrink-0">
          Launch a market
        </Link>
      </div>

      <div
        className="field mt-6 h-11 gap-2.5 sm:max-w-sm"
        style={{ borderRadius: 12, background: "rgba(255,255,255,0.05)" }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8B90A6" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <label htmlFor="commodity-search" className="sr-only">
          Search commodities
        </label>
        <input
          id="commodity-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="gold, crude, cocoa, daytona…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </div>

      {/* Pre-redesign feature panel, restyled: TCGplayer-wide tokenization, disabled until v2. */}
      <section className="glass mt-5 flex flex-col gap-2.5 p-5" aria-labelledby="tokenize-heading">
        <h2 id="tokenize-heading" className="display text-base font-semibold">
          Tokenize anything
        </h2>
        <p className="max-w-xl text-[13px] leading-relaxed text-muted">
          Every product on TCGplayer, screened for depth. Deep enough markets become a coin and can be
          paired with any launch — coming in v2.
        </p>
        <div className="group relative">
          <label htmlFor="tokenize-search" className="sr-only">
            Search anything to tokenize
          </label>
          <input
            id="tokenize-search"
            disabled
            aria-describedby="tokenize-tooltip"
            placeholder="Charizard, Black Lotus, One Piece booster box…"
            className="field cursor-not-allowed text-sm text-muted"
          />
          <span
            id="tokenize-tooltip"
            role="tooltip"
            className="chip pointer-events-none absolute left-3 top-full mt-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Coming in v2
          </span>
        </div>
      </section>

      {isLoading && (
        <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass h-[132px] animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && indexCoins.length > 0 && (
        <Section
          title="Index coins"
          note="Baskets priced as the weighted sum of their legs' oracle prices. Pair a market with one like any other commodity coin."
        >
          {indexCoins.map(({ quote, seeded, legs }) => (
            <CommodityTile
              key={quote.symbol}
              commodity={quote}
              badge="Index"
              href={seeded ? undefined : null}
              footer={seeded ? `${quote.marketsCount} markets` : legs.map((l) => l.symbol).join(" · ")}
            />
          ))}
        </Section>
      )}

      {!isLoading &&
        CATEGORY_ORDER.map((cat) => {
          const items = byCategory.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <Section key={cat} title={CATEGORY_LABEL[cat]}>
              {items.map((c) => (
                <CommodityTile key={c.symbol} commodity={c} />
              ))}
            </Section>
          );
        })}

      {!isLoading && indexCoins.length === 0 && CATEGORY_ORDER.every((c) => (byCategory.get(c) ?? []).length === 0) && (
        <p className="mt-12 text-center text-sm text-muted">No commodity matches that search.</p>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex flex-col gap-1">
        <h2 className="eyebrow">{title}</h2>
        {note && <p className="max-w-2xl text-xs text-muted">{note}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}
