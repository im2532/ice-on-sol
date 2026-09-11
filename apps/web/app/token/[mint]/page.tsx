"use client";

import { useState } from "react";
import { notFound, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchCandles, fetchCommodity, fetchMarket, fetchTrades } from "@/lib/api";
import { compact, compactNum, pct, pctClass, shortenAddress } from "@/lib/format";
import Chart from "@/components/Chart";
import TradePanel from "@/components/TradePanel";
import TradesTable from "@/components/TradesTable";
import { bySymbol } from "@icemarkets/registry";

type ChartTab = "icemarkets" | "birdeye";

export default function TokenPage() {
  const params = useParams<{ mint: string }>();
  const mint = params.mint;
  const [chartTab, setChartTab] = useState<ChartTab>("icemarkets");

  const { data: market, isLoading } = useQuery({ queryKey: ["market", mint], queryFn: () => fetchMarket(mint) });
  const { data: commodity } = useQuery({
    queryKey: ["commodity", market?.commoditySymbol],
    queryFn: () => fetchCommodity(market!.commoditySymbol),
    enabled: !!market,
  });
  const { data: candles } = useQuery({
    queryKey: ["candles", mint],
    queryFn: () => fetchCandles(mint),
    enabled: !!market && chartTab === "icemarkets",
  });
  const { data: trades } = useQuery({ queryKey: ["trades", mint], queryFn: () => fetchTrades(mint), enabled: !!market });

  if (!isLoading && market === null) notFound();
  if (!market) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="icemarkets-card h-64 animate-pulse" />
      </div>
    );
  }

  const halted = commodity?.status === "halted";
  const birdeyeUrl = `https://birdeye.so/tv-widget/${mint}?chain=solana&theme=dark`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-surface2 text-2xl" aria-hidden="true">
            {market.image}
          </div>
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">
              {market.name} <span className="text-green">${market.ticker}</span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface2 px-2 py-1 text-muted">
                <span aria-hidden="true">{market.commodityEmoji}</span> Paired with {market.commodityName}
              </span>
              <span className="font-nums text-muted">{shortenAddress(market.mint, 5)}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(market.mint).catch(() => {})}
                className="icemarkets-btn-secondary icemarkets-focus rounded-md px-2 py-0.5 text-[11px]"
              >
                Copy
              </button>
              <a
                href={`https://solscan.io/token/${market.mint}`}
                target="_blank"
                rel="noreferrer noopener"
                className="icemarkets-focus text-green hover:underline"
              >
                Explorer ↗
              </a>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-muted">Market cap</div>
          <div className="font-nums text-2xl font-semibold">{compact(market.fdvUsd)}</div>
          <div className={`font-nums text-sm ${pctClass(market.change24h)}`}>{pct(market.change24h)}</div>
        </div>
      </div>

      {halted && (
        <div role="alert" className="icemarkets-card mt-4 border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
          {market.commoditySymbol}&apos;s price feed is stale — market value will return when it recovers.
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat
          label="Pool"
          value={market.migrated ? "DAMM v2" : `${market.curveProgressPct.toFixed(0)}% DBC curve`}
        />
        <MiniStat label="Trading fee" value={`${(market.feeBps / 100).toFixed(0)}%`} />
        <MiniStat label="Holder earnings" value={`${compactNum(market.holderEarningsCoin, 2)} ${market.commoditySymbol}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="icemarkets-card p-4">
            <div role="tablist" aria-label="Chart source" className="mb-3 flex gap-1">
              {(
                [
                  ["icemarkets", "ICEmarkets"],
                  ["birdeye", "Birdeye"],
                ] as [ChartTab, string][]
              ).map(([t, label]) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={chartTab === t}
                  onClick={() => setChartTab(t)}
                  className={`icemarkets-focus rounded-md px-3 py-1 text-xs font-medium ${
                    chartTab === t ? "bg-green/10 text-green" : "text-muted hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {chartTab === "icemarkets" ? (
              candles ? (
                <Chart kind="candles" data={candles} height={340} />
              ) : (
                <div className="h-[340px] animate-pulse" />
              )
            ) : (
              <iframe
                title="Birdeye chart"
                src={birdeyeUrl}
                className="h-[340px] w-full rounded-lg border border-border"
                loading="lazy"
              />
            )}
          </div>

          <div className="icemarkets-card mt-4 p-4">
            <h2 className="mb-2 text-sm font-semibold">Trades</h2>
            <TradesTable trades={trades ?? []} coinSymbol={market.commoditySymbol} />
          </div>

          <div className="icemarkets-card mt-4 p-4">
            <h2 className="text-sm font-semibold">Official pools</h2>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span>
                {market.ticker} / {market.commoditySymbol}
              </span>
              <span className="font-nums text-muted">{shortenAddress(market.dammPool ?? market.dbcPool)}</span>
            </div>
            <p className="mt-3 text-xs text-muted">
              Created by <span className="font-nums">{shortenAddress(market.creator)}</span>
            </p>
          </div>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          {/* SOL/USDC buys route through peg_desk.buy (blocked while the paired coin is Closed); buying with the
              coin itself only touches the DBC/DAMM pool, so it stays available. Sells always settle via peg_desk.sell. */}
          <TradePanel
            mint={market.mint}
            coinSymbol={market.commoditySymbol}
            payOptions={["SOL", "USDC", "COIN"]}
            status={commodity?.status}
            sessionKind={bySymbol(market.commoditySymbol)?.session}
            buyWhileClosed={["COIN"]}
          />
          <p className="mt-3 text-center text-xs text-muted">
            <Link href={`/commodities/${market.commoditySymbol}`} className="text-green hover:underline">
              View {market.commoditySymbol} commodity page
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="icemarkets-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 font-nums text-lg font-semibold">{value}</div>
    </div>
  );
}
