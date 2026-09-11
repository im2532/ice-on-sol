import Link from "next/link";
import type { LeaderboardRow } from "@/lib/types";
import { compactNum, usd } from "@/lib/format";

export default function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted">No payouts yet.</p>;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              #
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Market
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Paired with
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Fee amounts
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Holder share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mint} className="border-b border-border/60 last:border-0 hover:bg-surface2/60">
              <td className="py-2.5 pr-3 font-nums text-muted">{r.rank}</td>
              <td className="py-2.5 pr-3">
                <Link href={`/token/${r.mint}`} className="icemarkets-focus flex items-center gap-2 rounded">
                  <span aria-hidden="true">{r.image}</span>
                  <span className="font-medium text-green">${r.ticker}</span>
                  <span className="hidden text-muted sm:inline">{r.name}</span>
                </Link>
              </td>
              <td className="py-2.5 pr-3 text-muted">
                <span aria-hidden="true">{r.pairedEmoji}</span> {r.pairedWith}
              </td>
              <td className="py-2.5 pr-3 text-right font-nums">
                {compactNum(r.feeAmountCoin, 2)} {r.feeCoinSymbol}
              </td>
              <td className="py-2.5 pr-3 text-right font-nums">{usd(r.holderShareUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
