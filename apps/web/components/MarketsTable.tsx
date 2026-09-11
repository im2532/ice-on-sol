"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchMarkets } from "@/lib/api";
import { compact, fmtAmount } from "@/lib/format";
import { curveLabel, signed, swatch } from "@/lib/visual";
import type { Market } from "@/lib/types";
import Bonding from "./Bonding";
import CommodityLogo from "./CommodityLogo";

type Tab = "all" | "new" | "migrated";

const TABS: [Tab, string][] = [
  ["all", "Trending"],
  ["new", "New pairs"],
  ["migrated", "Graduated"],
];

const FIRST_PAGE = 10;
const PAGE_STEP = 50;

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

/** The home page's Markets table: tabs, search, six columns, "Show 50 more". Rows on mobile. */
export default function MarketsTable() {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(FIRST_PAGE);

  // Trending ranks by 24h volume, New pairs by age, Graduated by market cap.
  const sort = tab === "all" ? "vol_desc" : tab === "new" ? "new" : "mcap_desc";

  const { data, isLoading } = useQuery({
    queryKey: ["markets", tab, query, pageSize],
    queryFn: () => fetchMarkets({ q: query || undefined, tab, sort, page: 1, pageSize }),
  });

  const markets = data?.markets ?? [];
  const total = data?.total ?? 0;

  function pick(next: Tab) {
    setTab(next);
    setPageSize(FIRST_PAGE);
  }

  return (
    <section className="glass overflow-hidden" aria-labelledby="markets-heading">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="markets-heading" className="display text-lg font-semibold">
            Markets
          </h2>
          <div className="tabset" role="tablist" aria-label="Filter markets">
            {TABS.map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => pick(t)}
                className={`tab tap text-xs ${tab === t ? "tab-on" : ""}`}
                style={{ height: 28 }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field h-9 min-h-0 gap-2.5 px-3.5 sm:w-[260px]" style={{ borderRadius: 10, background: "rgba(255,255,255,0.05)" }}>
          <span className="text-muted">
            <SearchIcon />
          </span>
          <label htmlFor="market-search" className="sr-only">
            Search markets by ticker, name or commodity
          </label>
          <input
            id="market-search"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPageSize(FIRST_PAGE);
            }}
            placeholder="Ticker, name or commodity"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {/* Desktop table. Column widths are fixed so numbers stay in a stable rhythm. */}
      <div className="hidden overflow-x-auto scrollbar-thin md:block">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup>
            <col style={{ width: "26%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "22%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="th">Market</th>
              <th className="th">Commodity</th>
              <th className="th text-right">Market cap</th>
              <th className="th text-right">24h</th>
              <th className="th">Curve</th>
              <th className="th text-right">Holders · 24h</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && markets.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ height: 56 }}>
                    <td className="td py-0" colSpan={6}>
                      <span className="block h-8 animate-pulse rounded-lg bg-white/[0.04]" />
                    </td>
                  </tr>
                ))
              : markets.map((m) => <Row key={m.mint} market={m} />)}
            {!isLoading && markets.length === 0 && (
              <tr>
                <td className="td text-center text-muted" colSpan={6}>
                  No market matches that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile rows */}
      <ul className="md:hidden">
        {markets.map((m) => (
          <li key={m.mint}>
            <Link
              href={`/token/${m.mint}`}
              className="tap flex items-center gap-3 border-b border-white/[0.06] px-4 py-3"
            >
              <span className="h-[34px] w-[34px] shrink-0 rounded-[10px]" style={{ background: swatch(m.ticker) }} aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="mono truncate text-[13px] font-semibold">{m.ticker}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  <CommodityLogo symbol={m.commoditySymbol} size={14} />
                  {m.commoditySymbol} · {m.migrated ? "graduated" : `${curveLabel(m.curveProgressPct, false)} of curve`}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end leading-tight">
                <span className="mono whitespace-nowrap text-[13px]">{compact(m.fdvUsd)}</span>
                <span
                  className={`mono whitespace-nowrap text-[11px] ${m.change24h >= 0 ? "text-positive" : "text-negative"}`}
                >
                  {signed(m.change24h, 1)}%
                </span>
              </span>
            </Link>
          </li>
        ))}
        {markets.length === 0 && !isLoading && (
          <li className="px-4 py-8 text-center text-sm text-muted">No market matches that search.</li>
        )}
      </ul>

      <div className="mono flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3.5 sm:px-5">
        <span className="text-xs text-muted">
          Showing {markets.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
        </span>
        {markets.length < total && (
          <button
            type="button"
            onClick={() => setPageSize((n) => n + PAGE_STEP)}
            className="tap rounded text-xs text-dim hover:text-text"
          >
            Show {PAGE_STEP} more
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * "320.9 HG" — but a long ticker eats the column, so past 8 characters the amount drops its
 * decimals ("321 DEAGLBLAZE") to keep the pair on one 13px line inside ~182px.
 */
function holderYield(m: Market): string {
  const longTicker = m.commoditySymbol.length > 8;
  const amount = longTicker ? Math.round(m.holderEarningsCoin).toLocaleString("en-US") : fmtAmount(m.holderEarningsCoin);
  return `${amount} ${m.commoditySymbol}`;
}

function Row({ market: m }: { market: Market }) {
  const up = m.change24h >= 0;
  return (
    <tr className="row-hover" style={{ height: 56 }}>
      <td className="td py-0">
        <Link href={`/token/${m.mint}`} className="flex items-center gap-2.5 rounded">
          <span className="h-8 w-8 shrink-0 rounded-[10px]" style={{ background: swatch(m.ticker) }} aria-hidden="true" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="mono truncate text-sm font-semibold">{m.ticker}</span>
            <span className="truncate text-xs text-muted">{m.name}</span>
          </span>
        </Link>
      </td>
      <td className="td py-0">
        <Link href={`/commodities/${m.commoditySymbol}`} className="chip mono gap-1.5 pl-2">
          <CommodityLogo symbol={m.commoditySymbol} size={16} />
          {m.commoditySymbol}
        </Link>
      </td>
      <td className="td mono whitespace-nowrap py-0 text-right">{compact(m.fdvUsd)}</td>
      <td
        className={`td mono whitespace-nowrap py-0 text-right ${up ? "text-positive" : "text-negative"}`}
      >
        {signed(m.change24h, 1)}%
      </td>
      <td className="td py-0">
        <Bonding pct={m.curveProgressPct} migrated={m.migrated} width={96} />
      </td>
      <td className="td mono whitespace-nowrap py-0 text-right">{holderYield(m)}</td>
    </tr>
  );
}
