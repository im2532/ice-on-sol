"use client";

import { useMemo, useState } from "react";
import { COMMODITIES, CATEGORY_LABEL } from "@icemarkets/registry";
import type { Category, Commodity } from "@icemarkets/registry";
import { usd } from "@/lib/format";

const CATEGORIES: (Category | "all")[] = [
  "all",
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

interface Step1Props {
  mode: "single" | "basket";
  onModeChange: (mode: "single" | "basket") => void;
  selected: string;
  onSelect: (symbol: string) => void;
  referencePriceUsd?: number;
}

export default function Step1Paired({ mode, onModeChange, selected, onSelect, referencePriceUsd }: Step1Props) {
  const [category, setCategory] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");

  const coins: Commodity[] = useMemo(
    () =>
      COMMODITIES.filter((c) => c.phase === "mvp")
        .filter((c) => category === "all" || c.category === category)
        .filter((c) => {
          if (!search) return true;
          const q = search.toLowerCase();
          return c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.displayName ?? "").toLowerCase().includes(q);
        }),
    [category, search]
  );

  const selectedCommodity = COMMODITIES.find((c) => c.symbol === selected);

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
          aria-pressed={mode === "basket"}
          disabled
          title="Index coins — v1.1"
          className="icemarkets-focus icemarkets-btn-secondary cursor-not-allowed rounded-full px-3.5 py-1.5 text-sm opacity-50"
        >
          Basket · up to 5{" "}
          <span className="ml-1 rounded bg-surface2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
            v1.1
          </span>
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
              {cat === "all" ? "All" : CATEGORY_LABEL[cat]}
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
                <span className="block truncate font-medium">{c.symbol}</span>
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
