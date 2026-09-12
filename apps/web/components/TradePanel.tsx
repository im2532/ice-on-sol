"use client";

import { Input } from "@/components/agentic/Input";
import CurrencyLogo from "@/components/CurrencyLogo";
import { Button } from "@/components/agentic/Button";
import SegmentedControl from "@/components/layout/SegmentedControl";
import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { NOT_ALLOWED_MESSAGE, walletAllowed } from "@/lib/allowlist";
import { buyCoin, sellCoin, type PayWith } from "@/lib/actions";
import { closedBuyTooltip, sessionOpensCopy } from "@/lib/session";
import { fmtAmount, fmtPrice, pct } from "@/lib/format";
import type { MarketStatus } from "@/lib/types";
import { toast } from "./Toast";
import CommodityLogo from "./CommodityLogo";

const SLIPPAGE_PCT = 0.5;

interface TradePanelProps {
  /** Mint being traded (a market on /token/[mint], or the commodity coin's own mint on /commodities/[symbol]). */
  mint: string;
  /** Symbol shown as a pay-with option when it's "COIN" — the commodity coin's ticker. */
  coinSymbol: string;
  payOptions: PayWith[];
  /**
   * On-chain status of the commodity coin behind this trade.
   * Closed → the Peg Desk only sells (Buy disabled unless `buyWhileClosed` allows a pay option);
   * Halted → both sides disabled while the price feed recovers.
   */
  status?: MarketStatus;
  /** Registry `SessionKind` of that commodity, for the "opens in …" copy. */
  sessionKind?: number;
  /**
   * Pay options that still work for BUYS while Closed because they never touch the Peg Desk (e.g. a memecoin
   * bought with its commodity coin directly on the DBC/DAMM pool). Empty (default) = Buy is disabled while Closed.
   */
  buyWhileClosed?: PayWith[];
  disabled?: boolean;
  disabledReason?: string;

  /* ---- presentation (optional; the panel works without any of it) ---- */
  /** Ticker of the thing being bought — the CTA reads "Buy TICKER". */
  ticker?: string;
  /** USD price of one unit of the traded asset, for the rough output estimate. */
  priceUsd?: number;
  /** USD price of one commodity-coin unit, shown on the "Commodity price" line. */
  commodityPriceUsd?: number;
  /** "lb", "t oz", … shown after the commodity price. */
  commodityUnitShort?: string;
  /** Seconds since the commodity price was last published on chain. */
  commodityAgeSec?: number;
  /** Trading fee in basis points; 40% of it is the holders' share. */
  feeBps?: number;
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
  ticker,
  priceUsd,
  commodityPriceUsd,
  commodityUnitShort,
  commodityAgeSec,
  feeBps,
}: TradePanelProps) {
  const closed = status === "closed";
  const halted = status === "halted";
  const closedBuyPays = useMemo(
    () => payOptions.filter((p) => buyWhileClosed.includes(p)),
    [payOptions, buyWhileClosed],
  );
  const buyTabDisabled = halted || (closed && closedBuyPays.length === 0);

  const [side, setSide] = useState<"buy" | "sell">(
    buyTabDisabled ? "sell" : "buy",
  );
  const [payWith, setPayWith] = useState<PayWith>(payOptions[0]);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const now = useMinuteClock();

  const closedTooltip = closedBuyTooltip(sessionKind, now);
  const payDisabled = (p: PayWith) =>
    side === "buy" && closed && !closedBuyPays.includes(p);

  // Status arrives asynchronously (react-query): default to Sell once the commodity turns out Closed, and move
  // the pay option off one that cannot buy while Closed.
  useEffect(() => {
    if (buyTabDisabled && side === "buy") setSide("sell");
  }, [buyTabDisabled, side]);
  useEffect(() => {
    if (
      side === "buy" &&
      closed &&
      !closedBuyPays.includes(payWith) &&
      closedBuyPays.length > 0
    )
      setPayWith(closedBuyPays[0]);
  }, [side, closed, closedBuyPays, payWith]);

  const payLabel = payWith === "COIN" ? coinSymbol : payWith;
  const outLabel = ticker ?? coinSymbol;
  const notAllowed = !!publicKey && !walletAllowed(publicKey);
  const tradingBlocked =
    disabled ||
    halted ||
    notAllowed ||
    (side === "buy" && buyTabDisabled) ||
    payDisabled(payWith);

  // Rough client-side estimate only — the real quote comes from the pool at signing time.
  const estimate = useMemo(() => {
    const amt = Number.parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0 || !priceUsd || priceUsd <= 0)
      return null;
    return side === "buy" ? amt / priceUsd : amt * priceUsd;
  }, [amount, priceUsd, side]);

  const holderShare = feeBps != null ? (feeBps / 100) * 0.4 : null;
  // Buying a memecoin hops through its commodity coin (USDC → HG → COPPERINU); trading the coin itself is
  // a single hop, so repeated legs collapse.
  const route = (
    side === "buy"
      ? [payLabel, coinSymbol, outLabel]
      : [outLabel, coinSymbol, payLabel]
  )
    .filter((leg, i, all) => leg && all.indexOf(leg) === i)
    .join(" → ");

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
      const params = {
        wallet: publicKey,
        mint,
        amountIn: amt,
        minOut: 0,
        payWith,
      };
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
    <div className="glass-strong trade-panel flex flex-col gap-4">
      {halted && (
        <p
          role="alert"
          className="chip chip-warn h-auto py-2 text-left leading-snug"
          style={{ whiteSpace: "normal" }}
        >
          Feed recovering — trading resumes automatically once a fresh price is
          posted.
        </p>
      )}

      {closed && !halted && (
        <p
          role="status"
          className="trade-warning flex items-start gap-2 rounded-xl px-3 py-2 text-left text-xs leading-snug"
          style={{
            background: "var(--color-badge-bg-yellow)",
            border: "1px solid var(--color-badge-stroke-default)",
            color: "var(--color-badge-label-yellow)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="mt-px shrink-0"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>
            {buyTabDisabled
              ? closedTooltip
              : `Market closed — buys only with ${closedBuyPays
                  .map((p) => (p === "COIN" ? coinSymbol : p))
                  .join("/")} until ${sessionOpensCopy(sessionKind, now)}`}
          </span>
        </p>
      )}

      <SegmentedControl
        label="Trade side"
        fullWidth
        value={side}
        options={[
          { value: "buy", label: "Buy", disabled: buyTabDisabled },
          { value: "sell", label: "Sell", disabled: halted },
        ]}
        onChange={setSide}
      />

      {/* Pay with */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">
          {side === "buy" ? "Pay with" : "Receive in"}
        </span>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={side === "buy" ? "Pay with" : "Receive in"}
        >
          {payOptions.map((p) => {
            const off = payDisabled(p) || halted;
            const on = payWith === p;
            return (
              <Button
                plain
                key={p}
                type="button"
                aria-pressed={on}
                disabled={off}
                title={payDisabled(p) ? closedTooltip : undefined}
                onClick={() => setPayWith(p)}
                className={`chip tap gap-1.5 ${p === "COIN" ? "pl-2" : ""} ${on ? "chip-on" : ""} disabled:cursor-not-allowed disabled:opacity-40`}
                style={{ height: 30 }}
              >
                {p === "COIN" && (
                  <CommodityLogo symbol={coinSymbol} size={14} />
                )}
                {(p === "USDC" || p === "SOL") && <CurrencyLogo symbol={p} size={18} />}
                {p === "COIN" ? coinSymbol : p}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Amount in */}
      <div className="well flex items-center justify-between gap-3 px-4 py-3.5">
        <label htmlFor="trade-amount" className="sr-only">
          Amount to {side}
        </label>
        <Input
          id="trade-amount"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          disabled={halted}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="mono w-full bg-transparent text-[26px] font-semibold outline-none placeholder:text-muted/50 disabled:cursor-not-allowed"
        />
        <span className="mono shrink-0 text-[13px] text-muted">
          {side === "buy" ? payLabel : outLabel}
        </span>
      </div>

      <div className="flex justify-center text-muted" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 4v16M6 14l6 6 6-6" />
        </svg>
      </div>

      {/* Estimated out */}
      <div className="well flex items-center justify-between gap-3 px-4 py-3.5">
        <span className="mono text-[26px] font-semibold">
          {estimate != null ? fmtAmount(estimate) : "—"}
        </span>
        <span className="mono shrink-0 text-[13px] text-muted">
          {side === "buy" ? outLabel : payLabel}
        </span>
      </div>

      {/* Route + terms */}
      <dl className="mono flex flex-col gap-1.5 text-xs">
        <Line k="Route" v={route} />
        {commodityPriceUsd != null && (
          <Line
            k="Commodity price"
            v={
              <>
                {fmtPrice(commodityPriceUsd)}
                {commodityUnitShort ? ` / ${commodityUnitShort}` : ""}
                {commodityAgeSec != null && (
                  <span className="text-muted">
                    {" "}
                    · {Math.round(commodityAgeSec)}s
                  </span>
                )}
              </>
            }
          />
        )}
        {feeBps != null && (
          <Line
            k="Fee"
            v={
              <>
                {pct(feeBps / 100, { decimals: 2, showSign: false })}{" "}
                <span className="text-positive">
                  → {pct(holderShare!, { decimals: 2, showSign: false })} to
                  holders
                </span>
              </>
            }
          />
        )}
        <Line k="Slippage" v={`${SLIPPAGE_PCT}%`} />
      </dl>

      {tradingBlocked ? (
        <Button
          plain
          type="button"
          disabled
          className="btn-primary tap h-12 w-full text-[15px]"
        >
          {halted
            ? "Feed recovering"
            : notAllowed
              ? NOT_ALLOWED_MESSAGE
              : disabled
                ? (disabledReason ?? "Trading unavailable")
                : "Market closed"}
        </Button>
      ) : (
        <Button
          plain
          type="button"
          onClick={submit}
          disabled={submitting}
          className="btn-primary tap h-12 w-full text-[15px]"
        >
          {submitting
            ? "Confirm in wallet…"
            : publicKey
              ? `${side === "buy" ? "Buy" : "Sell"} ${outLabel}`
              : "Connect"}
        </Button>
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
