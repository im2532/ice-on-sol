"use client";

import { useMemo, useState } from "react";
import type { Payout, Trade } from "@/lib/types";
import { fmtAmount, shortenAddress, timeAgo, usd } from "@/lib/format";

type TradesTab = "trades" | "payouts" | "holders";

const TABS: [TradesTab, string][] = [
  ["trades", "Trades"],
  ["payouts", "Holder payouts"],
  ["holders", "Holders"],
];

interface TradesTableProps {
  ticker: string;
  commoditySymbol: string;
  trades: Trade[];
  /** Holder payouts for this market (from the payouts feed); empty until the indexer serves them. */
  payouts?: Payout[];
  holders?: number;
}

/** The token page's activity panel: trades, holder payouts and holders, one glass panel, three tabs. */
export default function TradesTable({
  ticker,
  commoditySymbol,
  trades,
  payouts = [],
  holders,
}: TradesTableProps) {
  const [tab, setTab] = useState<TradesTab>("trades");

  // The feed is ordered here rather than trusting the caller: newest trade and payout first.
  const sorted = useMemo(() => trades.slice().sort((a, b) => b.ts - a.ts), [trades]);
  const sortedPayouts = useMemo(() => payouts.slice().sort((a, b) => b.ts - a.ts), [payouts]);

  return (
    <section className="glass overflow-hidden" aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] p-3.5 sm:px-5">
        <h2 id="activity-heading" className="display text-[15px] font-semibold">
          Activity
        </h2>
        <div className="tabset" role="tablist" aria-label="Activity view">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`tab tap text-xs ${tab === t ? "tab-on" : ""}`}
              style={{ height: 26 }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        {tab === "trades" &&
          (sorted.length === 0 ? (
            <Empty>No trades on this market yet.</Empty>
          ) : (
            <table className="mono w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <th className="th">Time</th>
                  <th className="th">Side</th>
                  <th className="th text-right">{ticker}</th>
                  <th className="th text-right">{commoditySymbol}</th>
                  <th className="th text-right">≈ USD</th>
                  <th className="th text-right">Trader</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 25).map((t) => (
                  <tr key={t.sig}>
                    <td className="td py-2.5 text-[13px] text-muted">{timeAgo(t.ts * 1000)}</td>
                    <td className={`td py-2.5 text-[13px] ${t.side === "buy" ? "text-positive" : "text-negative"}`}>
                      {t.side === "buy" ? "Buy" : "Sell"}
                    </td>
                    <td className="td py-2.5 text-right text-[13px]">{fmtAmount(t.baseAmount)}</td>
                    <td className="td py-2.5 text-right text-[13px]">{fmtAmount(t.quoteAmount)}</td>
                    <td className="td py-2.5 text-right text-[13px] text-muted">{usd(t.baseAmount * t.priceUsd)}</td>
                    <td className="td py-2.5 text-right text-[13px] text-muted">{shortenAddress(t.trader)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === "payouts" &&
          (sortedPayouts.length === 0 ? (
            <Empty>
              No holder payout has settled on this market yet. The first lands within fifteen minutes of the
              first trade.
            </Empty>
          ) : (
            <table className="mono w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  <th className="th">Time</th>
                  <th className="th">Wallet</th>
                  <th className="th text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {sortedPayouts.map((p) => (
                  <tr key={p.id}>
                    <td className="td py-2.5 text-[13px] text-muted">{timeAgo(p.ts * 1000)}</td>
                    <td className="td py-2.5 text-[13px]">{shortenAddress(p.wallet)}</td>
                    <td className="td py-2.5 text-right text-[13px] text-positive">
                      {fmtAmount(p.amount)} {p.commoditySymbol}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === "holders" && (
          <Empty>
            {holders != null
              ? `${holders.toLocaleString("en-US")} wallets hold ${ticker}. The per-wallet list arrives with the indexer.`
              : "The per-wallet holder list arrives with the indexer."}
          </Empty>
        )}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-muted">{children}</p>;
}
