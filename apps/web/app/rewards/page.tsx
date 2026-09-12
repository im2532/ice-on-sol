"use client";

import SegmentedControl from "@/components/layout/SegmentedControl";
import { Button } from "@/components/agentic/Button";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import PageHeader, { PageStats } from "@/components/layout/PageHeader";
import { Icon } from "@/components/agentic/Icon/Icon";
import { fetchStats, fetchLeaderboard, fetchWalletRewards } from "@/lib/api";
import { compact, fmtAmount, usd } from "@/lib/format";
import Leaderboard from "@/components/Leaderboard";
import FeeDonut from "@/components/FeeDonut";
import CommodityLogo from "@/components/CommodityLogo";
import { claim } from "@/lib/actions";

const STEPS: [string, string][] = [
  [
    "Hold a market's token",
    "Every trade on that market charges its fee. 40% of it is set aside for holders.",
  ],
  [
    "Get paid automatically",
    "Each cycle pays holders in the commodity coin, weighted by balance, straight to the wallet.",
  ],
  [
    "Keep or sell",
    "Commodity coins track a real commodity. Hold them, or sell them for USDC right here at the feed price.",
  ],
];

export default function RewardsPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
  });
  const [coinFilter, setCoinFilter] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState(15);

  const { data: leaderboard } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: fetchLeaderboard,
  });
  const { data: rewards } = useQuery({
    queryKey: ["rewards", publicKey?.toBase58()],
    queryFn: () => fetchWalletRewards(publicKey!.toBase58()),
    enabled: !!publicKey,
  });

  const totalHolderShare = useMemo(
    () =>
      leaderboard
        ? leaderboard.reduce((sum, r) => sum + r.holderShareUsd, 0)
        : 0,
    [leaderboard],
  );

  const coinChips = useMemo(() => {
    if (!leaderboard) return [];
    const map = new Map<string, number>();
    for (const r of leaderboard)
      map.set(r.pairedWith, (map.get(r.pairedWith) ?? 0) + r.holderShareUsd);
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [leaderboard]);

  const rows = useMemo(() => {
    if (!leaderboard) return [];
    const filtered = coinFilter
      ? leaderboard.filter((r) => r.pairedWith === coinFilter)
      : leaderboard;
    return filtered.slice(0, visibleRows);
  }, [leaderboard, coinFilter, visibleRows]);

  const totalRows = leaderboard
    ? (coinFilter
        ? leaderboard.filter((r) => r.pairedWith === coinFilter)
        : leaderboard
      ).length
    : 0;

  async function handleClaim(symbol: string) {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    try {
      await claim(
        { wallet: publicKey, coinSymbol: symbol },
        { connection, sendTransaction },
      );
    } catch {
      // claim() already toasts
    }
  }

  return (
    <div className="agentic-page container-x pb-16 pt-8 md:pt-12">
      <PageHeader
        eyebrow="A share of every trade"
        title="Rewards"
        description="Hold a market token. Earn in its paired commodity. Track the rewards flowing back to the community."
      />
      <PageStats
        items={[
          {
            label: "Total paid to holders",
            value: stats ? compact(stats.paidToHoldersUsd) : "—",
            note: "Across the exchange",
          },
          {
            label: "Rewards · 24h",
            value: stats ? compact(stats.paidToHolders24hUsd) : "—",
            note: "Paid in commodity coins",
          },
          {
            label: "Holder wallets",
            value: stats?.holderWallets.toLocaleString("en-US") ?? "—",
            note: "Sharing in trading fees",
          },
        ]}
      />
      <div className="detail-grid mt-7">
        <div className="flex flex-col gap-5">
          {/* ---- wallet earnings ---- */}
          <section
            className="glass flex flex-col gap-4 p-5"
            aria-labelledby="earnings-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="earnings-heading"
                className="display text-base font-semibold"
              >
                Your earnings
              </h2>
              {publicKey && rewards ? (
                <span className="mono text-lg font-semibold text-positive">
                  {usd(rewards.totalEarnedUsd)}
                </span>
              ) : null}
            </div>

            {publicKey && rewards ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {rewards.byCoin.map((c) => (
                  <li
                    key={c.symbol}
                    className="flex items-center justify-between gap-3 rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <CommodityLogo symbol={c.symbol} size={28} />
                      <span className="mono text-sm">{c.symbol}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5">
                      <span className="mono text-sm">
                        {fmtAmount(c.amount)}
                      </span>
                      {c.claimable > 0 && (
                        <Button
                          plain
                          type="button"
                          onClick={() => handleClaim(c.symbol)}
                          className="chip chip-positive tap"
                          title={`Claim ${fmtAmount(c.claimable)} ${c.symbol} held in a Merkle epoch`}
                        >
                          Claim
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-wallet">
                <svg className="wallet-illustration" width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden="true">
                  <ellipse cx="60" cy="85" rx="43" ry="5" fill="var(--color-border-subtle)" />
                  <rect x="35" y="11" width="57" height="45" rx="6" transform="rotate(12 35 11)" fill="var(--color-bg-primary)" stroke="var(--color-border-medium)" strokeWidth="1.5" />
                  <path d="M25 33L80 19" stroke="var(--color-content-secondary)" strokeWidth="1.5" />
                  <rect x="20" y="30" width="80" height="50" rx="10" fill="var(--color-bg-primary)" stroke="var(--color-content-primary)" strokeWidth="2" />
                  <path d="M20 42H98" stroke="var(--color-border-subtle)" />
                  <rect x="77" y="47" width="28" height="20" rx="5" fill="var(--color-bg-secondary)" stroke="var(--color-content-primary)" strokeWidth="2" />
                  <circle cx="86" cy="57" r="2.5" fill="var(--color-content-primary)" />
                  <path d="M12 23V31M8 27H16M106 12V20M102 16H110" stroke="var(--color-content-secondary)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <h3>Your rewards start here</h3>
                <p>Connect a wallet to see what each commodity coin has paid you and track your earnings in one place.</p>
                <Button type="button" onClick={() => setVisible(true)}>Connect wallet</Button>
              </div>
            )}
          </section>

          {/* ---- leaderboard ---- */}
          <section
            className="glass overflow-hidden"
            aria-labelledby="leaderboard-heading"
          >
            <div className="flex flex-col gap-3 border-b border-white/[0.08] p-4 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="leaderboard-heading"
                  className="display text-lg font-semibold"
                >
                  Leaderboard
                </h2>
                <span className="mono text-xs text-muted">
                  {usd(totalHolderShare)} paid to holders by all markets
                </span>
              </div>
              <div className="filter-bar">
                <SegmentedControl label="Filter by commodity coin" value={coinFilter ?? "all"}
                  onChange={(value) => { setCoinFilter(value === "all" ? null : value); setVisibleRows(15); }}
                  options={[{ value: "all", label: "All" }, ...coinChips.map(([symbol, amount]) => ({ value: symbol, label: `${symbol} ${usd(amount, { decimals: 0 })}` }))]}
                />
              </div>
            </div>

            <Leaderboard rows={rows} />

            {rows.length < totalRows && (
              <div className="mono flex justify-between border-t border-white/[0.08] px-4 py-3.5 sm:px-5">
                <span className="text-xs text-muted">
                  Showing {rows.length} of {totalRows}
                </span>
                <Button
                  plain
                  type="button"
                  onClick={() => setVisibleRows((v) => v + 15)}
                  className="tap rounded text-xs text-dim hover:text-text"
                >
                  Show 15 more
                </Button>
              </div>
            )}
          </section>
        </div>

        {/* ---- rail ---- */}
        <div className="flex flex-col gap-5">
          <FeeDonut />
          <section
            className="glass flex flex-col gap-4 p-5"
            aria-labelledby="how-heading"
          >
            <h2 id="how-heading" className="eyebrow">
              How it reaches you
            </h2>
            <ol className="rewards-steps">
              {STEPS.map(([title, body], i) => (
                <li key={title} className="rewards-step">
                  <span
                    className="step-badge"
                    style={{
                      background: "var(--color-bg-secondary)",
                      color: "var(--color-badge-label-green)",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="rewards-step-copy flex flex-col gap-1">
                    <span className="text-sm font-semibold">{title}</span>
                    <span className="text-[13px] leading-relaxed text-muted">
                      {body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
