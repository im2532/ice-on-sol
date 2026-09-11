"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { buyCoin, sellCoin, type PayWith } from "@/lib/actions";
import { toast } from "./Toast";

interface TradePanelProps {
  /** Mint being traded (memecoin on /token/[mint], or the commodity coin's own mint on /commodities/[symbol]). */
  mint: string;
  /** Symbol shown as a pay-with option when it's "COIN" — e.g. the commodity ticker. */
  coinSymbol: string;
  payOptions: PayWith[];
  disabled?: boolean;
  disabledReason?: string;
}

export default function TradePanel({ mint, coinSymbol, payOptions, disabled, disabledReason }: TradePanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [payWith, setPayWith] = useState<PayWith>(payOptions[0]);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();

  const payLabel = payWith === "COIN" ? coinSymbol : payWith;

  async function submit() {
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
      <div role="tablist" aria-label="Trade side" className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-surface2 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={`icemarkets-focus rounded-md py-2 text-sm font-semibold capitalize transition-colors ${
              side === s ? (s === "buy" ? "bg-positive text-[#06120c]" : "bg-negative text-[#1a0505]") : "text-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mb-1.5 text-xs font-medium text-muted">Pay with</div>
      <div className="mb-3 flex gap-1.5" role="group" aria-label="Pay with">
        {payOptions.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={payWith === p}
            onClick={() => setPayWith(p)}
            className={`icemarkets-focus rounded-lg border px-3 py-1.5 text-xs font-medium ${
              payWith === p ? "border-green/50 bg-green/10 text-green" : "border-border text-muted hover:text-text"
            }`}
          >
            {p === "COIN" ? coinSymbol : p}
          </button>
        ))}
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
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="icemarkets-focus w-full bg-transparent font-nums text-lg outline-none placeholder:text-muted/60"
        />
        <span className="ml-2 shrink-0 text-xs font-medium text-muted">{payLabel}</span>
      </div>

      {disabled ? (
        <button type="button" disabled className="icemarkets-btn-primary icemarkets-focus w-full py-2.5 text-sm">
          {disabledReason ?? "Trading unavailable"}
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
