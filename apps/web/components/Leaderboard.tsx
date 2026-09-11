import Link from "next/link";
import type { LeaderboardRow } from "@/lib/types";
import { fmtAmount, usd } from "@/lib/format";
import { swatch } from "@/lib/visual";

/** Markets ranked by what they have paid holders, styled like the home page's Markets table. */
export default function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-muted">No rewards have been paid yet.</p>;
  }
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr>
            <th className="th">#</th>
            <th className="th">Market</th>
            <th className="th">Paired with</th>
            <th className="th text-right">Fees collected</th>
            <th className="th text-right">Paid to holders</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mint} className="row-hover">
              <td className="td mono text-muted">{r.rank}</td>
              <td className="td">
                <Link href={`/token/${r.mint}`} className="flex items-center gap-2.5 rounded">
                  <span
                    className="h-8 w-8 shrink-0 rounded-[10px]"
                    style={{ background: swatch(r.ticker) }}
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="mono truncate text-sm font-semibold">{r.ticker}</span>
                    <span className="truncate text-xs text-muted">{r.name}</span>
                  </span>
                </Link>
              </td>
              <td className="td">
                <Link href={`/commodities/${r.pairedWith}`} className="chip mono">
                  {r.pairedWith}
                </Link>
              </td>
              <td className="td mono whitespace-nowrap text-right">
                {fmtAmount(r.feeAmountCoin)} {r.feeCoinSymbol}
              </td>
              <td className="td mono whitespace-nowrap text-right text-positive">{usd(r.holderShareUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
