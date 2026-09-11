"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchRecentPayouts } from "@/lib/api";
import { fmtAmount, shortenAddress, timeAgo } from "@/lib/format";
import { swatch } from "@/lib/visual";
import { PAYOUT } from "@icemarkets/registry";

/** Minutes:seconds left in the current payout cycle, from the fixed cycle length. */
function nextCycle(nowSec: number): string {
  const left = PAYOUT.cycleSec - (nowSec % PAYOUT.cycleSec);
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "Holder rewards" — the live feed of payouts landing in holder wallets. */
export default function RewardsFeed({ limit = 4 }: { limit?: number }) {
  const { data } = useQuery({
    queryKey: ["recent-payouts", limit],
    queryFn: () => fetchRecentPayouts(limit),
    refetchInterval: 30_000,
  });

  const rows = data ?? [];
  const cycle = rows.length > 0 ? nextCycle(rows[0].ts) : null;

  return (
    <section className="glass flex flex-col p-4 sm:px-5" aria-labelledby="rewards-feed-heading">
      <div className="flex items-center justify-between pb-1">
        <h2 id="rewards-feed-heading" className="display text-base font-semibold">
          Holder rewards
        </h2>
        <span className="chip mono" style={{ height: 22, fontSize: 11 }}>
          <span
            className="live-dot h-1.5 w-1.5 rounded-full bg-positive"
            style={{ boxShadow: "0 0 8px #14F195" }}
            aria-hidden="true"
          />
          live
        </span>
      </div>
      <p className="pb-2 text-xs text-muted">
        Paid in the commodity coin, every 15 minutes, nothing to claim.
      </p>

      <ul>
        {rows.length === 0 &&
          Array.from({ length: limit }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 border-b border-white/[0.06] py-2.5 last:border-0">
              <span className="h-7 w-7 shrink-0 animate-pulse rounded-[9px] bg-white/[0.06]" />
              <span className="h-7 flex-1 animate-pulse rounded bg-white/[0.04]" />
            </li>
          ))}
        {rows.map((p) => (
          <li key={p.id} className="flex items-center gap-3 border-b border-white/[0.06] py-2.5 last:border-0">
            <span
              className="h-7 w-7 shrink-0 rounded-[9px] opacity-60"
              style={{ background: swatch(p.commoditySymbol) }}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="mono truncate text-[13px]">
                {shortenAddress(p.wallet)} <span className="text-muted">received</span>{" "}
                {fmtAmount(p.amount)} {p.commoditySymbol}
              </span>
              <span className="truncate text-[11px] text-muted">
                <Link href={`/token/${p.mint}`} className="rounded hover:text-dim">
                  {p.ticker}
                </Link>{" "}
                · {timeAgo(p.ts * 1000)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {cycle && (
        <div className="mono mt-3 flex justify-between border-t border-white/[0.08] pt-3 text-xs">
          <span className="text-muted">Next payout</span>
          <span>in {cycle}</span>
        </div>
      )}
    </section>
  );
}
