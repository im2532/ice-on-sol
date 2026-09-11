"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CATEGORY_LABEL, INDEX_COINS } from "@icemarkets/registry";
import type { Category } from "@icemarkets/registry";
import { fetchCommodities } from "@/lib/api";
import { fmtPrice } from "@/lib/format";
import type { CommodityQuote } from "@/lib/types";
import CommodityLogo from "@/components/CommodityLogo";

type Filter = Category | "all" | "index";

const INDEX_SYMBOLS = new Set(INDEX_COINS.map((c) => c.symbol));

const FILTERS: Filter[] = [
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

const PAGE = 6;

function label(f: Filter): string {
  if (f === "all") return "All";
  if (f === "index") return "Index coins";
  return CATEGORY_LABEL[f];
}

/** Step 1: search, category chips and a grid of commodity coins; the selected one takes a green ring. */
export default function CommodityPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (symbol: string) => void;
}) {
  const { data } = useQuery({ queryKey: ["commodities"], queryFn: fetchCommodities });
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const coins: CommodityQuote[] = useMemo(() => {
    if (!data) return [];
    return data
      .filter((c) =>
        filter === "all"
          ? true
          : filter === "index"
            ? INDEX_SYMBOLS.has(c.symbol)
            : c.category === filter && !INDEX_SYMBOLS.has(c.symbol)
      )
      .filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          c.symbol.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.displayName ?? "").toLowerCase().includes(q)
        );
      });
  }, [data, filter, search]);

  // The chosen coin always stays on screen, even when the filter or search would hide it.
  const visible = useMemo(() => {
    const head = coins.slice(0, shown);
    if (head.some((c) => c.symbol === selected)) return head;
    const chosen = data?.find((c) => c.symbol === selected);
    return chosen ? [chosen, ...head.slice(0, Math.max(0, shown - 1))] : head;
  }, [coins, shown, selected, data]);

  return (
    <section className="glass flex flex-col gap-3.5 p-5 sm:px-[22px]" aria-labelledby="pair-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="step-badge" style={{ background: "rgba(20,241,149,0.18)", color: "#14F195" }}>
            1
          </span>
          <h2 id="pair-heading" className="display text-base font-semibold">
            Paired with
          </h2>
        </div>
        <div
          className="field h-[34px] min-h-0 gap-2.5 px-3 sm:w-[240px]"
          style={{ borderRadius: 10, background: "rgba(255,255,255,0.05)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B90A6" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <label htmlFor="pair-search" className="sr-only">
            Search commodity coins
          </label>
          <input
            id="pair-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShown(PAGE);
            }}
            placeholder="gold, crude, cocoa, daytona…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setShown(PAGE);
            }}
            className={`chip tap ${filter === f ? "chip-on" : ""}`}
          >
            {label(f)}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="listbox" aria-label="Commodity coins">
        {visible.map((c) => {
          const on = c.symbol === selected;
          return (
            <button
              key={c.symbol}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => onSelect(c.symbol)}
              className="tap flex items-center gap-3 rounded-[14px] border px-3.5 py-3 text-left transition-colors"
              style={
                on
                  ? {
                      borderColor: "rgba(20,241,149,0.5)",
                      background: "rgba(20,241,149,0.08)",
                      boxShadow: "inset 0 0 0 1px rgba(20,241,149,0.3)",
                    }
                  : { borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }
              }
            >
              <CommodityLogo symbol={c.symbol} size={36} />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="mono text-[13px] font-semibold">{c.symbol}</span>
                <span className="truncate text-[11px] text-muted">
                  {c.displayName ?? c.name} · {c.unit}
                </span>
              </span>
              <span className="mono shrink-0 text-xs">{fmtPrice(c.priceUsd)}</span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-muted">No commodity matches that search.</p>
        )}
      </div>

      <p className="mono text-xs text-muted">
        Showing {visible.length} of {coins.length}
        {coins.length > visible.length && (
          <>
            {" · "}
            <button type="button" onClick={() => setShown((n) => n + 12)} className="tap rounded link">
              see more
            </button>
          </>
        )}
      </p>
    </section>
  );
}
