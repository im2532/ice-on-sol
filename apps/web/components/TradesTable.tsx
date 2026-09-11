import type { Trade } from "@/lib/types";
import { compactNum, shortenAddress, timeAgo } from "@/lib/format";

export default function TradesTable({ trades, coinSymbol }: { trades: Trade[]; coinSymbol: string }) {
  if (trades.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted">No trades yet.</p>;
  }
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">
              Time
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Side
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Amount
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              {coinSymbol} amount
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Trader
            </th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.sig} className="border-b border-border/60 last:border-0">
              <td className="py-2 pr-4 font-nums text-xs text-muted">{timeAgo(t.ts * 1000)}</td>
              <td className={`py-2 pr-4 font-medium ${t.side === "buy" ? "text-positive" : "text-negative"}`}>
                {t.side === "buy" ? "Buy" : "Sell"}
              </td>
              <td className="py-2 pr-4 font-nums">{compactNum(t.baseAmount)}</td>
              <td className="py-2 pr-4 font-nums">
                {compactNum(t.quoteAmount, 2)} {coinSymbol}
              </td>
              <td className="py-2 pr-4 font-nums text-muted">{shortenAddress(t.trader)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
