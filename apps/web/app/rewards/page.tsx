"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fetchLeaderboard, fetchWalletRewards } from "@/lib/api";
import { compactNum, usd } from "@/lib/format";
import Leaderboard from "@/components/Leaderboard";
import { claim } from "@/lib/actions";
import { toast } from "@/components/Toast";

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

  const filteredRows = useMemo(() => {
    if (!leaderboard) return [];
    const rows = coinFilter ? leaderboard.filter((r) => r.pairedWith === coinFilter) : leaderboard;
    return rows.slice(0, visibleRows);
  }, [leaderboard, coinFilter, visibleRows]);

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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Rewards</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Holders of every market earn 40% of its trading fees, paid automatically in the commodity coin it
        is paired with. Track what you have earned and claim your coins here.
      </p>

      <section className="icemarkets-card mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Hold a market, get paid in commodities.</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            40% of every trading fee is paid to holders of that market, in the commodity coin it is paired
            with, every 15 minutes. Wallets without a token account accrue a Merkle claim instead.
          </p>
        </div>
        {!publicKey && (
          <button type="button" onClick={() => setVisible(true)} className="icemarkets-btn-primary icemarkets-focus shrink-0 px-5 py-2.5 text-sm">
            Connect wallet
          </button>
        )}
      </section>

      {publicKey && rewards && (
        <section className="icemarkets-card mt-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Your earnings</h2>
            <span className="font-nums text-lg font-semibold">{usd(rewards.totalEarnedUsd)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rewards.byCoin.map((c) => (
              <div key={c.symbol} className="flex items-center justify-between rounded-lg border border-border bg-surface2 px-3 py-2">
                <span className="flex items-center gap-1.5 text-sm">
                  <span aria-hidden="true">{c.emoji}</span>
                  {c.symbol}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-nums text-sm">{compactNum(c.amount, 3)}</span>
                  {c.claimable > 0 && (
                    <button
                      type="button"
                      onClick={() => handleClaim(c.symbol)}
                      className="icemarkets-focus rounded-md bg-green/10 px-2 py-1 text-[11px] font-medium text-green hover:bg-green/20"
                    >
                      Claim
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        <StepCard n={1} title="Hold any market's token" body="Every trade on that market charges its fee. 40% of it is set aside for holders." />
        <StepCard n={2} title="Get paid automatically" body="Each cycle pays holders in the commodity coin, weighted by balance, straight to the wallet." />
        <StepCard n={3} title="Keep or sell" body="Coins track a real commodity. Hold them, or sell them for USDC right here at the feed price." />
      </section>

      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Leaderboard</h2>
          <span className="font-nums text-sm text-muted">Holder share earned by all markets: {usd(totalHolderShare)}</span>
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter leaderboard by coin">
          <button
            type="button"
            aria-pressed={coinFilter === null}
            onClick={() => setCoinFilter(null)}
            className={`icemarkets-focus rounded-full px-3 py-1.5 text-xs font-medium ${
              coinFilter === null ? "bg-green/10 text-green" : "icemarkets-btn-secondary"
            }`}
          >
            All
          </button>
          {coinChips.map(([symbol, amount]) => (
            <button
              key={symbol}
              type="button"
              aria-pressed={coinFilter === symbol}
              onClick={() => setCoinFilter(symbol)}
              className={`icemarkets-focus rounded-full px-3 py-1.5 text-xs font-medium ${
                coinFilter === symbol ? "bg-green/10 text-green" : "icemarkets-btn-secondary"
              }`}
            >
              {symbol} {usd(amount, { decimals: 0 })}
            </button>
          ))}
        </div>

        <div className="icemarkets-card p-4">
          <Leaderboard rows={filteredRows} />
          {leaderboard && filteredRows.length < (coinFilter ? leaderboard.filter((r) => r.pairedWith === coinFilter).length : leaderboard.length) && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setVisibleRows((v) => v + 15)}
                className="icemarkets-btn-secondary icemarkets-focus px-5 py-2 text-sm"
              >
                Show more
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StepCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="icemarkets-card p-5">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-green/10 text-xs font-semibold text-green">{n}</span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}
