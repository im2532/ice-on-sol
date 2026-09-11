"use client";

import { useState } from "react";
import { notFound, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchCommodity, fetchCommodityPriceHistory, fetchMarkets } from "@/lib/api";
import { compact, pct, pctClass, shortenAddress, timeAgo, usd } from "@/lib/format";
import Chart from "@/components/Chart";
import TradePanel from "@/components/TradePanel";
import StatusPill from "@/components/StatusPill";
import MarketCard from "@/components/MarketCard";
import { INDEX_COINS, bySymbol } from "@icemarkets/registry";

type Range = "24h" | "7d" | "30d";

export default function CommodityPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  const [range, setRange] = useState<Range>("24h");

  const { data: commodity, isLoading } = useQuery({
    queryKey: ["commodity", symbol],
    queryFn: () => fetchCommodity(symbol),
  });
  const { data: history } = useQuery({
    queryKey: ["commodity-history", symbol, range],
    queryFn: () => fetchCommodityPriceHistory(symbol, range),
    enabled: !!commodity,
  });
  const { data: pairedMarkets } = useQuery({
    queryKey: ["commodity-markets", symbol],
    queryFn: () => fetchMarkets({ q: symbol, pageSize: 6 }),
    enabled: !!commodity,
  });

  if (!isLoading && commodity === null) notFound();
  if (!commodity) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="icemarkets-card h-64 animate-pulse" />
      </div>
    );
  }

  const status = commodity.status;
  const displayName = commodity.displayName ?? commodity.name;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-surface2 text-2xl" aria-hidden="true">
            {commodity.emoji}
          </div>
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">
              {displayName} <span className="text-muted">${commodity.symbol}</span>
              {INDEX_COINS.some((c) => c.symbol === commodity.symbol) && (
                <span className="ml-2 rounded bg-surface2 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-muted">
                  Index
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-xs text-muted">
              Tracks {displayName} · 1 {commodity.symbol} = {commodity.unit}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="font-nums text-2xl font-semibold">{usd(commodity.priceUsd, { decimals: commodity.priceUsd < 1 ? 4 : 2 })}</div>
          <div className={`font-nums text-sm ${pctClass(commodity.change24h)}`}>{pct(commodity.change24h)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusPill status={status} />
        <span>on-chain {timeAgo(Date.now() - commodity.lastPublishedAgoSec * 1000)}</span>
      </div>

      {status === "halted" && (
        <div role="alert" className="icemarkets-card mt-4 border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
          A current price is unavailable. Market value will return when the price feed recovers.
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="icemarkets-card p-4">
            <div role="tablist" aria-label="Chart range" className="mb-3 flex gap-1">
              {(["24h", "7d", "30d"] as Range[]).map((r) => (
                <button
                  key={r}
                  role="tab"
                  aria-selected={range === r}
                  onClick={() => setRange(r)}
                  className={`icemarkets-focus rounded-md px-3 py-1 text-xs font-medium ${
                    range === r ? "bg-green/10 text-green" : "text-muted hover:text-text"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {history ? <Chart kind="line" data={history} height={300} /> : <div className="h-[300px] animate-pulse" />}
          </div>

          <div className="icemarkets-card mt-4 p-4">
            <h2 className="text-sm font-semibold">Contract</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-nums text-muted">{shortenAddress(commodity.mint, 6)}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(commodity.mint).catch(() => {})}
                className="icemarkets-btn-secondary icemarkets-focus rounded-md px-2.5 py-1 text-xs"
              >
                Copy
              </button>
              <a
                href={`https://solscan.io/token/${commodity.mint}`}
                target="_blank"
                rel="noreferrer noopener"
                className="icemarkets-focus rounded text-xs text-green hover:underline"
              >
                Explorer ↗
              </a>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted">Reserve ratio</div>
                <div className="font-nums font-medium">{(commodity.reserveRatioBps / 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-xs text-muted">Supply outstanding</div>
                <div className="font-nums font-medium">{compact(commodity.supplyOutstanding, { prefix: "" })}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Supply cap</div>
                <div className="font-nums font-medium">{compact(commodity.supplyCap, { prefix: "" })}</div>
              </div>
            </div>
          </div>

          {pairedMarkets && pairedMarkets.markets.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-semibold">Markets paired with {commodity.symbol}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {pairedMarkets.markets.map((m) => (
                  <MarketCard key={m.mint} market={m} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <TradePanel
            mint={commodity.mint}
            coinSymbol={commodity.symbol}
            payOptions={["USDC"]}
            status={status}
            sessionKind={bySymbol(commodity.symbol)?.session}
          />
          <p className="mt-3 text-center text-xs text-muted">
            Redeemable only against the protocol&apos;s USDC reserve.{" "}
            <Link href="/docs" className="text-green hover:underline">
              Learn more
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
