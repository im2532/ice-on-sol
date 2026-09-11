"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fetchLeaderboard, fetchWalletRewards } from "@/lib/api";
import { fmtAmount, usd } from "@/lib/format";
import { swatch } from "@/lib/visual";
import Leaderboard from "@/components/Leaderboard";
import FeeDonut from "@/components/FeeDonut";
import { claim } from "@/lib/actions";

const STEPS: [string, string][] = [
  ["Hold a market's token", "Every trade on that market charges its fee. 40% of it is set aside for holders."],
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
  const [coinFilter, setCoinFilter] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState(15);

  const { data: leaderboard } = useQuery({ queryKey: ["leaderboard"], queryFn: fetchLeaderboard });
  const { data: rewards } = useQuery({
    queryKey: ["rewards", publicKey?.toBase58()],
    queryFn: () => fetchWalletRewards(publicKey!.toBase58()),
    enabled: !!publicKey,
  });

  const totalHolderShare = useMemo(
    () => (leaderboard ? leaderboard.reduce((sum, r) => sum + r.holderShareUsd, 0) : 0),
    [leaderboard]
  );

  const coinChips = useMemo(() => {
    if (!leaderboard) return [];
    const map = new Map<string, number>();
    for (const r of leaderboard) map.set(r.pairedWith, (map.get(r.pairedWith) ?? 0) + r.holderShareUsd);
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [leaderboard]);

  const rows = useMemo(() => {
    if (!leaderboard) return [];
    const filtered = coinFilter ? leaderboard.filter((r) => r.pairedWith === coinFilter) : leaderboard;
    return filtered.slice(0, visibleRows);
  }, [leaderboard, coinFilter, visibleRows]);

  const totalRows = leaderboard
    ? (coinFilter ? leaderboard.filter((r) => r.pairedWith === coinFilter) : leaderboard).length
    : 0;

  async function handleClaim(symbol: string) {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    try {
      await claim({ wallet: publicKey, coinSymbol: symbol }, { connection, sendTransaction });
    } catch {
      // claim() already toasts
    }
  }

  return (
    <div className="container-x pb-16 pt-8 md:pt-12">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Rewards</span>
        <h1 className="display text-[32px] font-bold leading-tight text-white md:text-[44px]">
          Hold a market, get paid in commodities.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-body">
          Holders of every market earn 40% of its trading fees, paid automatically in the commodity coin it
          is paired with — every fifteen minutes, with nothing to claim. Track what you have earned here.
        </p>
      </header>

      <div className="mt-7 grid gap-5 lg:grid-cols-[8fr_4fr] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-5">
          {/* ---- wallet earnings ---- */}
          <section className="glass flex flex-col gap-4 p-5" aria-labelledby="earnings-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="earnings-heading" className="display text-base font-semibold">
                Your earnings
              </h2>
              {publicKey && rewards ? (
                <span className="mono text-lg font-semibold text-positive">{usd(rewards.totalEarnedUsd)}</span>
              ) : (
                <button type="button" onClick={() => setVisible(true)} className="btn-ghost tap">
                  Connect wallet
                </button>
              )}
            </div>

            {publicKey && rewards ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {rewards.byCoin.map((c) => (
                  <li
                    key={c.symbol}
                    className="flex items-center justify-between gap-3 rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="h-7 w-7 shrink-0 rounded-[9px]"
                        style={{ background: swatch(c.symbol) }}
                        aria-hidden="true"
                      />
                      <span className="mono text-sm">{c.symbol}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5">
                      <span className="mono text-sm">{fmtAmount(c.amount)}</span>
                      {c.claimable > 0 && (
                        <button
                          type="button"
                          onClick={() => handleClaim(c.symbol)}
                          className="chip chip-positive tap"
                          title={`Claim ${fmtAmount(c.claimable)} ${c.symbol} held in a Merkle epoch`}
                        >
                          Claim
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-relaxed text-muted">
                Connect a wallet to see what each commodity coin has paid you. Payouts land automatically —
                the Claim buttons here only cover remainders held in a Merkle epoch, for wallets that had no
                token account at payout time.
              </p>
            )}
          </section>

          {/* ---- leaderboard ---- */}
          <section className="glass overflow-hidden" aria-labelledby="leaderboard-heading">
            <div className="flex flex-col gap-3 border-b border-white/[0.08] p-4 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="leaderboard-heading" className="display text-lg font-semibold">
                  Leaderboard
                </h2>
                <span className="mono text-xs text-muted">
                  {usd(totalHolderShare)} paid to holders by all markets
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by commodity coin">
                <button
                  type="button"
                  aria-pressed={coinFilter === null}
                  onClick={() => setCoinFilter(null)}
                  className={`chip tap ${coinFilter === null ? "chip-on" : ""}`}
                >
                  All
                </button>
                {coinChips.map(([symbol, amount]) => (
                  <button
                    key={symbol}
                    type="button"
                    aria-pressed={coinFilter === symbol}
                    onClick={() => setCoinFilter(symbol)}
                    className={`chip mono tap ${coinFilter === symbol ? "chip-on" : ""}`}
                  >
                    {symbol} {usd(amount, { decimals: 0 })}
                  </button>
                ))}
              </div>
            </div>

            <Leaderboard rows={rows} />

            {rows.length < totalRows && (
              <div className="mono flex justify-between border-t border-white/[0.08] px-4 py-3.5 sm:px-5">
                <span className="text-xs text-muted">
                  Showing {rows.length} of {totalRows}
                </span>
                <button
                  type="button"
                  onClick={() => setVisibleRows((v) => v + 15)}
                  className="tap rounded text-xs text-dim hover:text-text"
                >
                  Show 15 more
                </button>
              </div>
            )}
          </section>
        </div>

        {/* ---- rail ---- */}
        <div className="flex flex-col gap-5">
          <FeeDonut />
          <section className="glass flex flex-col gap-4 p-5" aria-labelledby="how-heading">
            <h2 id="how-heading" className="eyebrow">
              How it reaches you
            </h2>
            <ol className="flex flex-col gap-4">
              {STEPS.map(([title, body], i) => (
                <li key={title} className="flex gap-3">
                  <span className="step-badge" style={{ background: "rgba(20,241,149,0.14)", color: "#14F195" }}>
                    {i + 1}
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">{title}</span>
                    <span className="text-[13px] leading-relaxed text-muted">{body}</span>
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
