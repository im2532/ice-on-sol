"use client";

import { Button } from "@/components/agentic/Button";
import SegmentedControl from "@/components/layout/SegmentedControl";
import { useState } from "react";
import { notFound, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  fetchCommodity,
  fetchCommodityPriceHistory,
  fetchMarkets,
} from "@/lib/api";
import {
  compact,
  fmtPriceUsd,
  pct,
  shortenAddress,
  timeAgo,
} from "@/lib/format";
import { signed } from "@/lib/visual";
import { formatDuration } from "@/lib/session";
import Chart from "@/components/Chart";
import TradePanel from "@/components/TradePanel";
import StatusPill from "@/components/StatusPill";
import MarketCard from "@/components/MarketCard";
import CommodityLogo from "@/components/CommodityLogo";
import {
  INDEX_COINS,
  OracleKind,
  SessionKind,
  bySymbol,
} from "@icemarkets/registry";

type Range = "24h" | "7d" | "30d";

const ORACLE_LABEL: Record<number, string> = {
  [OracleKind.PythPull]: "Pyth",
  [OracleKind.Switchboard]: "Switchboard",
  [OracleKind.KeeperSigned]: "Keeper-signed",
  [OracleKind.Composite]: "Composite",
};

const SESSION_LABEL: Record<number, string> = {
  [SessionKind.Continuous]: "24/7",
  [SessionKind.CmeGlobex]: "CME Globex",
  [SessionKind.IceUs]: "ICE US",
  [SessionKind.Lme]: "LME",
  [SessionKind.Slow]: "Slow feed",
};

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
  const { data: paired } = useQuery({
    queryKey: ["commodity-markets", symbol],
    queryFn: () => fetchMarkets({ q: symbol, pageSize: 6 }),
    enabled: !!commodity,
  });

  if (!isLoading && commodity === null) notFound();
  if (!commodity) {
    return (
      <div className="agentic-page container-x py-10">
        <div className="glass h-72 animate-pulse" />
      </div>
    );
  }

  // Risk parameters live in the registry, not the indexer quote.
  const spec = bySymbol(commodity.symbol);
  const displayName = commodity.displayName ?? commodity.name;
  const isIndex = INDEX_COINS.some((c) => c.symbol === commodity.symbol);
  const flat = Math.abs(commodity.change24h) < 0.005;

  return (
    <div className="agentic-page container-x pb-16 pt-7 md:pt-9">
      <nav aria-label="Breadcrumb" className="mono text-xs text-muted">
        <Link href="/" className="rounded hover:text-dim">
          Markets
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/commodities" className="rounded hover:text-dim">
          Commodities
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-dim">{commodity.symbol}</span>
      </nav>

      <header className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4 sm:gap-[18px]">
          <CommodityLogo symbol={commodity.symbol} size={72} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="display text-2xl font-bold sm:text-[32px]">
                {displayName}
              </h1>
              <span className="mono text-sm text-muted sm:text-base">
                {commodity.symbol}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={commodity.status} />
              {isIndex && <span className="chip mono">Index</span>}
              <span className="chip mono">
                1 {commodity.symbol} = {commodity.unit}
              </span>
              <span className="chip mono text-muted">
                on chain{" "}
                {timeAgo(Date.now() - commodity.lastPublishedAgoSec * 1000)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-0.5 sm:items-end">
          <span className="eyebrow">Price</span>
          <span className="mono text-[28px] font-semibold tracking-tight sm:text-[36px]">
            {fmtPriceUsd(commodity.priceUsd)}
          </span>
          <span
            className={`mono text-[13px] ${flat ? "text-muted" : commodity.change24h > 0 ? "text-positive" : "text-negative"}`}
          >
            {signed(commodity.change24h)}% · 24h
          </span>
        </div>
      </header>

      {commodity.status === "halted" && (
        <p
          role="alert"
          className="chip chip-warn mt-4 h-auto py-2"
          style={{ whiteSpace: "normal" }}
        >
          A current price is unavailable. Market value will return when the
          price feed recovers.
        </p>
      )}

      <div className="detail-grid mt-6">
        <div className="flex flex-col gap-5">
          <section
            className="glass flex flex-col gap-3 px-4 pb-3.5 pt-4 sm:px-5"
            aria-label="Price chart"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="display">Price history</h2>
              <SegmentedControl
                label="Chart range"
                value={range}
                options={(["24h", "7d", "30d"] as Range[]).map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={setRange}
              />
            </div>
            {history ? (
              <Chart kind="line" data={history} height={300} />
            ) : (
              <div className="h-[300px] animate-pulse rounded-xl bg-white/[0.03]" />
            )}
          </section>

          {/* Contract and Reserve sit side by side so neither leaves a half-empty row. */}
          <div className="grid gap-5 md:grid-cols-2 md:items-stretch">
            <section
              className="glass flex flex-col gap-4 p-4 sm:px-5"
              aria-labelledby="contract-heading"
            >
              <h2 id="contract-heading" className="eyebrow">
                Contract
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  plain
                  type="button"
                  onClick={() =>
                    navigator.clipboard
                      ?.writeText(commodity.mint)
                      .catch(() => {})
                  }
                  aria-label={`Copy the ${commodity.symbol} mint address`}
                  title={commodity.mint}
                  className="chip mono tap"
                >
                  {shortenAddress(commodity.mint, 6)}
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                </Button>
                <a
                  href={`https://solscan.io/token/${commodity.mint}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="chip tap link"
                >
                  Explorer ↗
                </a>
              </div>
              <dl className="mt-auto grid grid-cols-2 gap-4">
                <Metric
                  k="Oracle"
                  v={ORACLE_LABEL[spec?.oracle.kind ?? OracleKind.PythPull]}
                />
                <Metric
                  k="Session"
                  v={SESSION_LABEL[spec?.session ?? SessionKind.Continuous]}
                />
              </dl>
            </section>

            <section
              className="glass flex flex-col gap-4 p-4 sm:px-5"
              aria-labelledby="reserve-heading"
            >
              <h2 id="reserve-heading" className="eyebrow">
                Reserve
              </h2>
              <dl className="grid grid-cols-2 gap-4">
                <Metric
                  k="Reserve ratio"
                  v={pct(commodity.reserveRatioBps / 100, {
                    decimals: 1,
                    showSign: false,
                  })}
                />
                <Metric
                  k="Spread"
                  v={
                    spec
                      ? pct(spec.params.baseSpreadBps / 100, {
                          decimals: 2,
                          showSign: false,
                        })
                      : "—"
                  }
                />
                <Metric
                  k="Supply outstanding"
                  v={compact(commodity.supplyOutstanding, { prefix: "" })}
                />
                <Metric
                  k="Supply cap"
                  v={compact(commodity.supplyCap, { prefix: "" })}
                />
                <Metric
                  k="Max age"
                  v={
                    spec
                      ? formatDuration(spec.params.maxAgeOpenSec * 1000)
                      : "—"
                  }
                />
              </dl>
            </section>
          </div>

          {paired && paired.markets.length > 0 && (
            <section aria-labelledby="paired-heading">
              <h2 id="paired-heading" className="eyebrow mb-3">
                Markets paired with {commodity.symbol}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {paired.markets.map((m) => (
                  <MarketCard key={m.mint} market={m} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-6">
          <TradePanel
            mint={commodity.mint}
            coinSymbol={commodity.symbol}
            payOptions={["USDC"]}
            status={commodity.status}
            sessionKind={spec?.session}
            ticker={commodity.symbol}
            priceUsd={commodity.priceUsd}
            commodityPriceUsd={commodity.priceUsd}
            commodityUnitShort={commodity.unitShort}
            commodityAgeSec={commodity.lastPublishedAgoSec}
          />
          <p className="text-center text-xs leading-relaxed text-muted">
            Redeemable only against the protocol's USDC reserve.{" "}
            <Link href="/docs" className="link">
              Learn more
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="mono text-sm font-semibold">{v}</dd>
    </div>
  );
}
