"use client";

import { useMemo, useState } from "react";
import { COMMODITIES, CATEGORY_LABEL, INDEX_COINS, bySymbol } from "@icemarkets/registry";
import type { Category, Commodity } from "@icemarkets/registry";
import { usd } from "@/lib/format";

type Filter = Category | "all" | "index";

const INDEX_SYMBOLS = new Set(INDEX_COINS.map((c) => c.symbol));

const CATEGORIES: Filter[] = [
  "all",
  "index",
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

interface Step1Props {
  mode: "single" | "basket";
  onModeChange: (mode: "single" | "basket") => void;
  selected: string;
  onSelect: (symbol: string) => void;
  referencePriceUsd?: number;
}

export default function Step1Paired({ mode, onModeChange, selected, onSelect, referencePriceUsd }: Step1Props) {
  const [category, setCategory] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  // Index coins (Composite) are just commodities to the launch builder: the SDK prices them from their legs.
  const coins: Commodity[] = useMemo(
    () =>
      [...COMMODITIES.filter((c) => c.phase === "mvp"), ...INDEX_COINS]
        .filter((c) => category === "all" || (category === "index" ? INDEX_SYMBOLS.has(c.symbol) : c.category === category && !INDEX_SYMBOLS.has(c.symbol)))
        .filter((c) => {
          if (!search) return true;
          const q = search.toLowerCase();
          return c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.displayName ?? "").toLowerCase().includes(q);
        }),
    [category, search]
  );

  const selectedCommodity = bySymbol(selected);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2" role="group" aria-label="Paired-with mode">
        <button
          type="button"
          aria-pressed={mode === "single"}
          onClick={() => onModeChange("single")}
          className={`icemarkets-focus rounded-full px-3.5 py-1.5 text-sm font-medium ${
            mode === "single" ? "bg-positive/10 text-positive" : "icemarkets-btn-secondary"
          }`}
        >
          Single coin
        </button>
        <button
          type="button"
          aria-pressed={category === "index"}
          onClick={() => setCategory("index")}
          className={`icemarkets-focus rounded-full px-3.5 py-1.5 text-sm font-medium ${
            category === "index" ? "bg-positive/10 text-positive" : "icemarkets-btn-secondary"
          }`}
        >
          Index coins
        </button>
      </div>

      {selectedCommodity && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface2 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-xl" aria-hidden="true">
              {selectedCommodity.emoji}
            </span>
            <div>
              <div className="text-sm font-semibold">
                {selectedCommodity.symbol} <span className="font-normal text-muted">{selectedCommodity.displayName ?? selectedCommodity.name}</span>
              </div>
              <div className="text-xs text-muted">Reference price</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-nums text-sm">{referencePriceUsd ? usd(referencePriceUsd, { decimals: referencePriceUsd < 1 ? 4 : 2 }) : "—"}</div>
            <div className="text-xs text-muted">
              one coin = {selectedCommodity.unitShort === selectedCommodity.symbol ? selectedCommodity.unit : selectedCommodity.unit}
            </div>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
              className={`icemarkets-focus rounded-full px-2.5 py-1 text-xs font-medium ${
                category === cat ? "bg-green/10 text-green" : "text-muted hover:text-text"
              }`}
            >
              {cat === "all" ? "All" : cat === "index" ? "Index coins" : CATEGORY_LABEL[cat]}
            </button>
          ))}
        </div>
        <div className="ml-auto min-w-[200px] flex-1">
          <label htmlFor="coin-search" className="sr-only">
            Search coins
          </label>
          <input
            id="coin-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search: gold, oil, corn, fries…"
            className="icemarkets-focus w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm placeholder:text-muted"
          />
        </div>
      </div>

      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto scrollbar-thin sm:grid-cols-4" role="listbox" aria-label="Coins to pair with">
        {coins.map((c) => {
          const active = c.symbol === selected;
          return (
            <button
              key={c.symbol}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelect(c.symbol)}
              className={`icemarkets-focus flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                active ? "border-green/50 bg-green/10" : "border-border hover:border-purple/40"
              }`}
            >
              <span aria-hidden="true">{c.emoji}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {c.symbol}
                  {INDEX_SYMBOLS.has(c.symbol) && (
                    <span className="ml-1.5 rounded bg-surface2 px-1 py-0.5 align-middle text-[9px] font-medium uppercase tracking-wide text-muted">Index</span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted">{c.displayName ?? c.name}</span>
              </span>
              {active && <span className="ml-auto text-green">✓</span>}
            </button>
          );
        })}
        {coins.length === 0 && <p className="col-span-full py-6 text-center text-sm text-muted">No coins match.</p>}
      </div>
      <p className="mt-2 text-xs text-muted">Pick the coin your market trades against.</p>
    </div>
  );
}
