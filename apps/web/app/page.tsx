"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchMarkets, fetchNewLaunches, fetchStats } from "@/lib/api";
import { compact, compactNum, usd } from "@/lib/format";
import StatTile from "@/components/StatTile";
import MarketCard from "@/components/MarketCard";
import CurveProgress from "@/components/CurveProgress";
import FeeSplitBar from "@/components/FeeSplitBar";
import Mascot from "@/components/Mascot";

type Tab = "all" | "new" | "migrated";
type Sort = "mcap_desc" | "mcap_asc" | "vol_desc" | "new";
const PAGE_SIZE = 8;

const SORT_LABEL: Record<Sort, string> = {
  mcap_desc: "Market cap: high to low",
  mcap_asc: "Market cap: low to high",
  vol_desc: "24h volume: high to low",
  new: "Newest first",
};

export default function MarketsPage() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("mcap_desc");
  const [page, setPage] = useState(1);

  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const { data: newLaunches } = useQuery({ queryKey: ["new-launches"], queryFn: () => fetchNewLaunches(5) });
  const { data: marketsData, isLoading } = useQuery({
    queryKey: ["markets", query, tab, sort, page],
    queryFn: () => fetchMarkets({ q: query || undefined, tab, sort, page, pageSize: PAGE_SIZE }),
  });

  const totalPages = marketsData ? Math.max(1, Math.ceil(marketsData.total / PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* ---- hero ---- */}
      <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
            Markets paired with <span className="icemarkets-gradient-text">real commodities</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            Memecoins priced in gold, oil, wheat and 80 other commodities. Every trade pays holders in the
            commodity.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/launch" className="icemarkets-btn-primary icemarkets-focus px-5 py-2.5 text-sm">
              Launch a market
            </Link>
            <Link href="/commodities" className="icemarkets-btn-secondary icemarkets-focus px-5 py-2.5 text-sm">
              Browse commodities
            </Link>
          </div>

          <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Markets" value={stats ? stats.marketsCount.toLocaleString() : "—"} />
            <StatTile label="Commodities" value={stats ? stats.commoditiesCount.toLocaleString() : "—"} />
            <StatTile label="24h volume" value={stats ? compact(stats.volume24hUsd) : "—"} />
            <StatTile label="Value locked" value={stats ? compact(stats.valueLockedUsd) : "—"} />
          </div>
        </div>

        <aside className="icemarkets-card p-5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Exchange coin</div>
          <div className="mt-2 flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-icemarkets-gradient-diag">
              <Mascot size={22} />
            </div>
            <div>
              <div className="text-sm font-semibold text-green">$ICE</div>
              <div className="text-xs text-muted">paired with GLD</div>
            </div>
          </div>
          <div className="mt-4 font-nums text-3xl font-semibold">{stats ? usd(stats.iceMcapUsd, { decimals: 2 }) : "—"}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-muted">Market cap</div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted">Burn share</div>
              <div className="font-nums font-medium">20%</div>
            </div>
            <div>
              <div className="text-muted">$ICE burned</div>
              <div className="font-nums font-medium">{stats ? compactNum(stats.iceBurned) : "—"}</div>
            </div>
          </div>
        </aside>
      </section>

      {/* ---- where the fees go ---- */}
      <section className="mt-12 icemarkets-card p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Where the fees go</h2>
          <p className="max-w-2xl text-sm text-muted">
            Every trade pays a fee in its paired commodity coin: 40% to holders every fifteen minutes, 20%
            buys and burns $ICE, 20% to the protocol — and 20% to Meteora, whose bonding-curve
            infrastructure we build on. We&apos;re upfront about that cut so the split adds up.
          </p>
        </div>
        <div className="mt-5">
          <FeeSplitBar />
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Paid to holders"
            value={stats ? usd(stats.paidToHoldersUsd, { decimals: 1 }) : "—"}
            sub={stats ? `${usd(stats.paidToHolders24hUsd, { decimals: 1 })} in 24h · ${(stats.holderWallets / 1000).toFixed(1)}K wallets` : undefined}
          />
          <StatTile label="$ICE bought back" value={stats ? usd(stats.iceBoughtBackUsd, { decimals: 0 }) : "—"} sub="spent on buybacks, 24h" />
          <StatTile
            label="Total $ICE burned"
            value={stats ? compactNum(stats.iceBurned) : "—"}
            sub={stats ? `${stats.iceBurnedPct}% of supply` : undefined}
            valueClassName="text-purple"
          />
        </div>
      </section>

      {/* ---- new launches ---- */}
      {newLaunches && newLaunches.length > 0 && (
        <section className="mt-12">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">New launches</h2>
            <button
              type="button"
              onClick={() => {
                setTab("new");
                document.getElementById("live-markets")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="icemarkets-focus rounded text-sm text-green hover:underline"
            >
              View new pairs ↗
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-5">
            {newLaunches.map((m) => (
              <div key={m.mint} className="w-64 shrink-0 sm:w-auto">
                <MarketCard market={m} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- live markets ---- */}
      <section id="live-markets" className="mt-12 scroll-mt-20">
        <h2 className="mb-3 text-lg font-semibold">Live markets</h2>

        <label htmlFor="market-search" className="sr-only">
          Search name, ticker, commodity
        </label>
        <input
          id="market-search"
          type="search"
          placeholder="Search name, ticker, commodity"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          className="icemarkets-focus w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm placeholder:text-muted focus:border-green/50"
        />

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Filter markets" className="flex gap-2">
            {(
              [
                ["all", "All"],
                ["new", "New pairs"],
                ["migrated", "Migrated"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  setPage(1);
                }}
                className={`icemarkets-focus rounded-lg px-3.5 py-1.5 text-sm font-medium ${
                  tab === t ? "bg-positive/10 text-positive" : "icemarkets-btn-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-muted">
            <span className="sr-only">Sort markets</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="icemarkets-focus icemarkets-btn-secondary rounded-lg px-3 py-1.5 text-sm"
            >
              {Object.entries(SORT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mb-3 mt-4 text-xs text-muted">
          {marketsData ? `${marketsData.total.toLocaleString()} markets` : "Loading…"}
        </p>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="icemarkets-card h-40 animate-pulse" />
            ))}
          </div>
        ) : marketsData && marketsData.markets.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {marketsData.markets.map((m) => (
              <MarketCard key={m.mint} market={m} />
            ))}
          </div>
        ) : (
          <div className="icemarkets-card flex flex-col items-center gap-3 px-4 py-16 text-center">
            <Mascot size={56} />
            <p className="text-sm text-muted">No markets match that search.</p>
          </div>
        )}

        {marketsData && totalPages > 1 && (
          <div className="mt-5 flex items-center justify-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="icemarkets-btn-secondary icemarkets-focus grid h-8 w-8 place-items-center rounded-lg disabled:opacity-40"
            >
              ‹
            </button>
            <span className="font-nums text-muted">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="icemarkets-btn-secondary icemarkets-focus grid h-8 w-8 place-items-center rounded-lg disabled:opacity-40"
            >
              ›
            </button>
          </div>
        )}
      </section>

      {/* ---- explainer cards ---- */}
      <section className="mt-14 grid gap-4 sm:grid-cols-3">
        <ExplainerCard
          dot="bg-positive"
          title="Launch"
          body="Every market opens at a $5,000 cap, paired with a commodity coin, as a real DBC pool from its first block."
        />
        <ExplainerCard
          dot="bg-green"
          title="Curve"
          body={
            <>
              The supply sits in the pool as a bonding curve up to a $35,000 cap.
              <CurveProgress pct={62} />
              Any terminal or router can trade it, day one.
            </>
          }
        />
        <ExplainerCard
          dot="bg-purple"
          title="Fees"
          body="40% of every fee goes to holders of the meme/commodity pair, paid in the commodity coin and weighted by balance. No creator share."
        />
      </section>
    </div>
  );
}

function ExplainerCard({ dot, title, body }: { dot: string; title: string; body: React.ReactNode }) {
  return (
    <div className="icemarkets-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-2.5 text-sm leading-relaxed text-muted">{body}</div>
    </div>
  );
}
