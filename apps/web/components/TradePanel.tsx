"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { buyCoin, sellCoin, type PayWith } from "@/lib/actions";
import { closedBuyTooltip, sessionOpensCopy } from "@/lib/session";
import type { MarketStatus } from "@/lib/types";
import { toast } from "./Toast";

interface TradePanelProps {
  /** Mint being traded (memecoin on /token/[mint], or the commodity coin's own mint on /commodities/[symbol]). */
  mint: string;
  /** Symbol shown as a pay-with option when it's "COIN" — e.g. the commodity ticker. */
  coinSymbol: string;
  payOptions: PayWith[];
  /**
   * On-chain status of the commodity behind this trade (the commodity itself, or the memecoin's paired coin).
   * Closed → the Peg Desk only sells (Buy disabled unless `buyWhileClosed` allows a pay option);
   * Halted → both sides disabled while the price feed recovers.
   */
  status?: MarketStatus;
  /** Registry `SessionKind` of that commodity, for the "opens in …" copy. */
  sessionKind?: number;
  /**
   * Pay options that still work for BUYS while Closed because they never touch the Peg Desk (e.g. a memecoin
   * bought with COIN directly on the DBC/DAMM pool). Empty (default) = the Buy tab is disabled while Closed.
   */
  buyWhileClosed?: PayWith[];
  disabled?: boolean;
  disabledReason?: string;
}

/** Re-render once a minute so countdown copy stays fresh. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function TradePanel({
  mint,
  coinSymbol,
  payOptions,
  status = "open",
  sessionKind,
  buyWhileClosed = [],
  disabled,
  disabledReason,
}: TradePanelProps) {
  const closed = status === "closed";
  const halted = status === "halted";
  const closedBuyPays = useMemo(() => payOptions.filter((p) => buyWhileClosed.includes(p)), [payOptions, buyWhileClosed]);
  const buyTabDisabled = halted || (closed && closedBuyPays.length === 0);

  const [side, setSide] = useState<"buy" | "sell">(buyTabDisabled ? "sell" : "buy");
  const [payWith, setPayWith] = useState<PayWith>(payOptions[0]);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const now = useMinuteClock();

  const closedTooltip = closedBuyTooltip(sessionKind, now);
  const payDisabled = (p: PayWith) => side === "buy" && closed && !closedBuyPays.includes(p);

  // Status arrives asynchronously (react-query): default to Sell once the market turns out Closed, and move
  // the pay option off one that cannot buy while Closed.
  useEffect(() => {
    if (buyTabDisabled && side === "buy") setSide("sell");
  }, [buyTabDisabled, side]);
  useEffect(() => {
    if (side === "buy" && closed && !closedBuyPays.includes(payWith) && closedBuyPays.length > 0) setPayWith(closedBuyPays[0]);
  }, [side, closed, closedBuyPays, payWith]);

  const payLabel = payWith === "COIN" ? coinSymbol : payWith;
  const tradingBlocked = disabled || halted || (side === "buy" && buyTabDisabled) || payDisabled(payWith);

  async function submit() {
    if (tradingBlocked) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter an amount first");
      return;
    }
    if (!publicKey) {
      setVisible(true);
      return;
    }
    setSubmitting(true);
    try {
      const params = { wallet: publicKey, mint, amountIn: amt, minOut: 0, payWith };
      const deps = { connection, sendTransaction };
      if (side === "buy") await buyCoin(params, deps);
      else await sellCoin(params, deps);
      setAmount("");
    } catch {
      // buyCoin/sellCoin already toast the error
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="icemarkets-card p-4">
      {halted && (
        <div role="alert" className="mb-4 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2 text-xs text-negative">
          The price feed is recovering — buying and selling resume automatically once a fresh price is posted.
        </div>
      )}

      <div role="tablist" aria-label="Trade side" className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-surface2 p-1">
        {(["buy", "sell"] as const).map((s) => {
          const tabDisabled = halted || (s === "buy" && buyTabDisabled);
          const tooltip = halted ? "Price feed recovering" : s === "buy" && buyTabDisabled ? closedTooltip : undefined;
          const tooltipId = `trade-tab-${s}-tooltip`;
          return (
            // The wrapper carries hover for the tooltip: disabled buttons don't emit pointer events everywhere.
            <span key={s} className="group relative">
              <button
                type="button"
                role="tab"
                aria-selected={side === s}
                aria-disabled={tabDisabled}
                aria-describedby={tooltip ? tooltipId : undefined}
                disabled={tabDisabled}
                title={tooltip}
                onClick={() => setSide(s)}
                className={`icemarkets-focus w-full rounded-md py-2 text-sm font-semibold capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  side === s ? (s === "buy" ? "bg-positive text-[#06120c]" : "bg-negative text-[#1a0505]") : "text-muted"
                }`}
              >
                {s}
              </button>
              {tooltip && (
                <span
                  id={tooltipId}
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-10 mt-1.5 w-max max-w-[260px] rounded-md border border-border bg-surface2 px-2.5 py-1 text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  {tooltip}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {closed && !halted && (
        <p className="-mt-2 mb-3 text-xs text-muted">
          {buyTabDisabled
            ? closedTooltip
            : `Market closed — buys only with ${closedBuyPays.map((p) => (p === "COIN" ? coinSymbol : p)).join("/")} until ${sessionOpensCopy(sessionKind, now)}`}
        </p>
      )}

      <div className="mb-1.5 text-xs font-medium text-muted">Pay with</div>
      <div className="mb-3 flex gap-1.5" role="group" aria-label="Pay with">
        {payOptions.map((p) => {
          const off = payDisabled(p) || halted;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={payWith === p}
              disabled={off}
              title={payDisabled(p) ? closedTooltip : undefined}
              onClick={() => setPayWith(p)}
              className={`icemarkets-focus rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                payWith === p ? "border-green/50 bg-green/10 text-green" : "border-border text-muted hover:text-text"
              }`}
            >
              {p === "COIN" ? coinSymbol : p}
            </button>
          );
        })}
      </div>

      <label htmlFor="trade-amount" className="sr-only">
        Amount to {side}
      </label>
      <div className="mb-4 flex items-center rounded-lg border border-border bg-surface2 px-3 py-2.5">
        <input
          id="trade-amount"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          disabled={halted}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="icemarkets-focus w-full bg-transparent font-nums text-lg outline-none placeholder:text-muted/60 disabled:cursor-not-allowed"
        />
        <span className="ml-2 shrink-0 text-xs font-medium text-muted">{payLabel}</span>
      </div>

      {tradingBlocked ? (
        <button type="button" disabled className="icemarkets-btn-primary icemarkets-focus w-full py-2.5 text-sm">
          {halted ? "Feed recovering" : disabled ? disabledReason ?? "Trading unavailable" : "Market closed"}
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="icemarkets-btn-primary icemarkets-focus w-full py-2.5 text-sm"
        >
          {submitting ? "Confirm in wallet…" : publicKey ? `${side === "buy" ? "Buy" : "Sell"}` : "Connect wallet"}
        </button>
      )}
    </div>
  );
}
