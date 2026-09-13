"use client";

import { Input } from "@/components/agentic/Input";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCommodities } from "@/lib/api";
import { CATEGORY_LABEL, INDEX_COINS } from "@icemarkets/registry";
import type { Category } from "@icemarkets/registry";
import type { CommodityQuote } from "@/lib/types";
import PageHeader, { PageStats } from "@/components/layout/PageHeader";
import { Icon } from "@/components/agentic/Icon/Icon";
import SegmentedControl from "@/components/layout/SegmentedControl";
import SearchField from "@/components/layout/SearchField";
import { Button } from "@/components/agentic/Button";
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
  const { data, isLoading } = useQuery({
    queryKey: ["commodities"],
    queryFn: fetchCommodities,
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");

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
    [search],
  );

  const byCategory = useMemo(() => {
    const map = new Map<Category, CommodityQuote[]>();
    if (!data) return map;
    for (const cat of CATEGORY_ORDER) {
      map.set(
        cat,
        data.filter(
          (c) =>
            c.category === cat && !INDEX_SYMBOLS.has(c.symbol) && matches(c),
        ),
      );
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
        (acc, l) =>
          acc +
          ((data.find((q) => q.symbol === l.symbol)?.priceUsd ?? 0) *
            l.weightBps) /
            10_000,
        0,
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

  const count = data
    ? data.filter((c) => !INDEX_SYMBOLS.has(c.symbol)).length
    : null;

  return (
    <div className="agentic-page container-x pb-16 pt-8 md:pt-12">
      <PageHeader
        eyebrow="Explore the underlying assets"
        title="Commodities"
        description="From gold and crude to collectibles. Discover the commodity coins that power every market."
        action={
          <Button href="/launch">
            <Icon name="plus" />
            Launch a market
          </Button>
        }
      />
      <PageStats
        items={[
          {
            label: "Commodity coins",
            value: count?.toLocaleString("en-US") ?? "—",
            note: "Real-world reference prices",
          },
          {
            label: "Asset categories",
            value: String(CATEGORY_ORDER.length),
            note: "Metals, energy, collectibles & more",
          },
          {
            label: "Index coins",
            value: String(INDEX_COINS.length),
            note: "Diversified baskets of commodities",
          },
        ]}
      />
      <div className="page-toolbar">
        <h2 className="display text-xl">Find a commodity</h2>
        <SearchField
            id="commodity-search"
            aria-label="Search commodities"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or symbol…"
          />
      </div>
      <div className="filter-bar">
        <SegmentedControl label="Commodity category" value={category} onChange={setCategory}
          options={[
            { value: "all", label: "All commodities" },
            { value: "index", label: "Index coins" },
            ...CATEGORY_ORDER.map(value => ({ value, label: CATEGORY_LABEL[value] })),
          ]}
        />
      </div>
      {isLoading && (
        <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass h-[132px] animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading &&
        (category === "all" || category === "index") &&
        indexCoins.length > 0 && (
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
                footer={
                  seeded
                    ? `${quote.marketsCount} markets`
                    : legs.map((l) => l.symbol).join(" · ")
                }
              />
            ))}
          </Section>
        )}

      {!isLoading &&
        CATEGORY_ORDER.map((cat) => {
          const items = byCategory.get(cat);
          if (
            !items ||
            items.length === 0 ||
            (category !== "all" && category !== cat)
          )
            return null;
          return (
            <Section key={cat} title={CATEGORY_LABEL[cat]}>
              {items.map((c) => (
                <CommodityTile key={c.symbol} commodity={c} />
              ))}
            </Section>
          );
        })}

      {!isLoading &&
        (category === "all"
          ? indexCoins.length === 0 &&
            CATEGORY_ORDER.every((c) => (byCategory.get(c) ?? []).length === 0)
          : category === "index"
            ? indexCoins.length === 0
            : (byCategory.get(category as Category) ?? []).length === 0) && (
          <p className="mt-12 text-center text-sm text-muted">
            No commodity matches that search.
          </p>
        )}
      <section className="coming-soon" aria-labelledby="tokenize-heading">
        <Icon name="sparkle" size={24} />
        <div>
          <h2 id="tokenize-heading">Tokenize anything</h2>
          <p>
            Discover and tokenize deeper collectible markets. TCGplayer-wide
            support is on its way.
          </p>
        </div>
        <span className="chip coming-v2">Coming in v2</span>
      </section>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex flex-col gap-1">
        <h2 className="display text-xl">{title}</h2>
        {note && <p className="max-w-2xl text-xs text-muted">{note}</p>}
      </div>
      <div className="commodity-grid">{children}</div>
    </section>
  );
}
