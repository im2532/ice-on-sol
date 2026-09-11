"use client";

import { useMemo, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchCandles, fetchCommodity, fetchMarket, fetchRecentPayouts, fetchTrades } from "@/lib/api";
import { compact, fmtAmount, fmtPrice, fmtPriceUsd, pct, shortenAddress, timeAgo, usd } from "@/lib/format";
import { curveLabel, signed, swatch, swatchColor } from "@/lib/visual";
import Chart from "@/components/Chart";
import TradePanel from "@/components/TradePanel";
import TradesTable from "@/components/TradesTable";
import { bySymbol } from "@icemarkets/registry";

type Denom = "usd" | "coin";
type Range = "1h" | "1d" | "7d" | "30d";

const RANGE_SEC: Record<Range, number> = { "1h": 3600, "1d": 86_400, "7d": 604_800, "30d": 2_592_000 };

export default function TokenPage() {
  const params = useParams<{ mint: string }>();
  const mint = params.mint;
  const [denom, setDenom] = useState<Denom>("usd");
  const [range, setRange] = useState<Range>("1d");

  const { data: market, isLoading } = useQuery({ queryKey: ["market", mint], queryFn: () => fetchMarket(mint) });
  const { data: commodity } = useQuery({
    queryKey: ["commodity", market?.commoditySymbol],
    queryFn: () => fetchCommodity(market!.commoditySymbol),
    enabled: !!market,
  });
  const { data: candles } = useQuery({ queryKey: ["candles", mint], queryFn: () => fetchCandles(mint), enabled: !!market });
  const { data: trades } = useQuery({ queryKey: ["trades", mint], queryFn: () => fetchTrades(mint), enabled: !!market });
  const { data: payouts } = useQuery({ queryKey: ["recent-payouts", 12], queryFn: () => fetchRecentPayouts(12) });

  // Candles arrive in USD; "Price in <COIN>" rescales by the market's own USD↔coin ratio, and the
  // range tabs slice the same series rather than refetching.
  const series = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    const cutoff = candles[candles.length - 1].ts - RANGE_SEC[range];
    const windowed = candles.filter((c) => c.ts >= cutoff);
    const rows = windowed.length > 1 ? windowed : candles;
    if (denom === "usd" || !market || market.priceUsd <= 0) return rows;
    const k = market.priceQuote / market.priceUsd;
    return rows.map((c) => ({ ...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k }));
  }, [candles, range, denom, market]);

  const marketPayouts = useMemo(
    () => (payouts ?? []).filter((p) => p.mint === mint),
    [payouts, mint]
  );

  if (!isLoading && market === null) notFound();
  if (!market) {
    return (
      <div className="container-x py-10">
        <div className="glass h-72 animate-pulse" />
      </div>
    );
  }

  const halted = commodity?.status === "halted";
  const closed = commodity?.status === "closed";
  const up = market.change24h >= 0;
  const commodityName = commodity?.displayName ?? market.commodityName;
  const holderPct = (market.feeBps / 100) * 0.4;

  return (
    <div className="container-x pb-16 pt-7 md:pt-9">
      {/* ---- breadcrumb + header ---- */}
      <nav aria-label="Breadcrumb" className="mono text-xs text-muted">
        <Link href="/" className="rounded hover:text-dim">
          Markets
        </Link>
        <span className="mx-1.5">/</span>
        <span>Token</span>
        <span className="mx-1.5">/</span>
        <span className="text-dim">{market.ticker}</span>
      </nav>

      <header className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4 sm:gap-[18px]">
          <span
            className="h-14 w-14 shrink-0 rounded-[18px] sm:h-[72px] sm:w-[72px] sm:rounded-[22px]"
            style={{ background: swatch(market.ticker), boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)" }}
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="display text-2xl font-bold sm:text-[32px]">{market.name}</h1>
              <span className="mono text-sm text-positive sm:text-base">{market.ticker}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/commodities/${market.commoditySymbol}`} className="chip tap">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: swatchColor(market.commoditySymbol) }}
                  aria-hidden="true"
                />
                Paired with {market.commoditySymbol} · {commodityName}
              </Link>
              <span className="chip mono">
                {market.migrated ? "Graduated · DAMM v2" : `${curveLabel(market.curveProgressPct, false)} of curve`}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(market.mint).catch(() => {})}
                aria-label={`Copy the ${market.ticker} contract address`}
                title={market.mint}
                className="chip mono tap text-muted"
              >
                {shortenAddress(market.mint)}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-0.5 sm:items-end">
          <span className="eyebrow">Market cap</span>
          <span className="mono text-[28px] font-semibold tracking-tight sm:text-[36px]">{compact(market.fdvUsd)}</span>
          <span className={`mono text-[13px] ${up ? "text-positive" : "text-negative"}`}>
            {signed(market.change24h, 1)}% · 24h
          </span>
        </div>
      </header>

      {(halted || closed) && (
        <p role="alert" className={`chip ${halted ? "chip-warn" : ""} mt-4 h-auto py-2`} style={{ whiteSpace: "normal" }}>
          {halted
            ? `${market.commoditySymbol}'s price feed is stale — market value will return when it recovers, and trading is paused until then.`
            : `${market.commoditySymbol} is closed for the session — sells settle now, buys resume when it reopens.`}
        </p>
      )}

      {/* ---- body ---- */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[8fr_4fr] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-5">
          {/* 4-stat strip */}
          <div className="glass grid grid-cols-2 overflow-hidden md:grid-cols-4">
            <StatCell
              label={`Price in ${market.commoditySymbol}`}
              value={fmtPrice(market.priceQuote)}
              sub={`≈ ${usd(market.priceUsd, { decimals: 6 })}`}
            />
            <StatCell
              label="Trading fee"
              value={pct(market.feeBps / 100, { decimals: 2, showSign: false })}
              sub={`${pct(holderPct, { decimals: 2, showSign: false })} to holders`}
            />
            <StatCell
              label="Paid to holders"
              value={`${fmtAmount(market.holderEarningsCoin)} ${market.commoditySymbol}`}
              sub={commodity ? `≈ ${usd(market.holderEarningsCoin * commodity.priceUsd, { decimals: 0 })} · all time` : "all time"}
              valueClass="text-positive"
            />
            <StatCell label="Holders" value="—" sub="indexer coming" last />
          </div>

          {/* Chart */}
          <section className="glass flex flex-col gap-3 px-4 pb-3.5 pt-4 sm:px-5" aria-label="Price chart">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="tabset" role="tablist" aria-label="Chart denomination">
                {(
                  [
                    ["usd", "Value in USD"],
                    ["coin", `Price in ${market.commoditySymbol}`],
                  ] as [Denom, string][]
                ).map(([d, label]) => (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    aria-selected={denom === d}
                    onClick={() => setDenom(d)}
                    className={`tab tap text-xs ${denom === d ? "tab-on" : ""}`}
                    style={{ height: 28 }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mono flex gap-0.5" role="tablist" aria-label="Chart range">
                {(["1h", "1d", "7d", "30d"] as Range[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="tab"
                    aria-selected={range === r}
                    onClick={() => setRange(r)}
                    className={`tab tap text-xs ${range === r ? "tab-on" : ""}`}
                    style={{ height: 28 }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {series.length > 0 ? (
              <Chart kind="candles" data={series} height={300} />
            ) : (
              <div className="h-[300px] animate-pulse rounded-xl bg-white/[0.03]" />
            )}
          </section>

          <TradesTable
            ticker={market.ticker}
            commoditySymbol={market.commoditySymbol}
            trades={trades ?? []}
            payouts={marketPayouts}
          />
        </div>

        {/* ---- right rail ---- */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-6">
          {/* SOL/USDC buys route through peg_desk.buy (blocked while the commodity is Closed); buying with the
              coin itself only touches the DBC/DAMM pool, so it stays available. Sells always settle via peg_desk.sell. */}
          <TradePanel
            mint={market.mint}
            coinSymbol={market.commoditySymbol}
            payOptions={["USDC", "SOL", "COIN"]}
            status={commodity?.status}
            sessionKind={bySymbol(market.commoditySymbol)?.session}
            buyWhileClosed={["COIN"]}
            ticker={market.ticker}
            priceUsd={market.priceUsd}
            commodityPriceUsd={commodity?.priceUsd}
            commodityUnitShort={commodity?.unitShort}
            commodityAgeSec={commodity?.lastPublishedAgoSec}
            feeBps={market.feeBps}
          />

          <section className="glass flex flex-col gap-3 p-4 sm:px-5" aria-labelledby="position-heading">
            <div className="flex items-center justify-between gap-2">
              <h2 id="position-heading" className="display text-[15px] font-semibold">
                Your position
              </h2>
              <span className="chip mono" style={{ height: 22, fontSize: 11 }}>
                connect to see
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-muted">
              Hold {market.ticker} and {pct(holderPct, { decimals: 2, showSign: false })} of every trade comes back to you in{" "}
              {market.commoditySymbol}, every fifteen minutes. Nothing to stake, nothing to claim.
            </p>
          </section>

          <section className="glass flex flex-col gap-2 p-4 sm:px-5" aria-labelledby="commodity-heading">
            <h2 id="commodity-heading" className="eyebrow">
              Paired with
            </h2>
            <div className="flex items-center justify-between gap-2">
              <Link href={`/commodities/${market.commoditySymbol}`} className="text-sm font-semibold hover:text-lavender">
                {market.commoditySymbol} · {commodityName}
              </Link>
              <span className="mono text-sm">
                {commodity ? fmtPriceUsd(commodity.priceUsd) : "—"}
                {commodity && <span className="text-muted"> / {commodity.unitShort}</span>}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Tracks a live oracle price{commodity ? `, last published ${timeAgo(Date.now() - commodity.lastPublishedAgoSec * 1000)}` : ""}.
              Redeemable for USDC against the protocol reserve, never for a physical asset.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
  valueClass = "",
  last = false,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 border-b border-white/[0.08] px-4 py-4 sm:px-5 md:border-b-0 ${
        last ? "" : "md:border-r"
      } last:border-b-0`}
    >
      <span className="eyebrow">{label}</span>
      <span className={`mono text-[17px] font-semibold sm:text-[18px] ${valueClass}`}>{value}</span>
      {sub && <span className="text-[11px] leading-snug text-muted">{sub}</span>}
    </div>
  );
}
