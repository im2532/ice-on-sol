"use client";

import { pct } from "@/lib/format";
import type { PayWith } from "@/lib/actions";

const FEE_TIERS = [100, 200, 300] as const;

export interface FeeState {
  feeBps: 100 | 200 | 300;
  payWith: Extract<PayWith, "USDC" | "SOL">;
  firstBuyUsd: string;
}

export const DEFAULT_FEE: FeeState = { feeBps: 200, payWith: "USDC", firstBuyUsd: "25" };

/** Step 3: the fee tier (with its holder share) plus how the first buy is paid. */
export default function FeeAndBuy({
  value,
  onChange,
  commoditySymbol,
}: {
  value: FeeState;
  onChange: (next: FeeState) => void;
  commoditySymbol: string;
}) {
  const set = <K extends keyof FeeState>(key: K, v: FeeState[K]) => onChange({ ...value, [key]: v });
  const payOptions: FeeState["payWith"][] = ["USDC", "SOL"];

  return (
    <section className="glass flex flex-col gap-3.5 p-5 sm:px-[22px]" aria-labelledby="launch-fee-heading">
      <div className="flex items-center gap-2.5">
        <span className="step-badge" style={{ background: "rgba(255,255,255,0.1)", color: "#EEF0F6" }}>
          3
        </span>
        <h2 id="launch-fee-heading" className="display text-base font-semibold">
          Fee and first buy
        </h2>
      </div>

      <fieldset>
        <legend className="sr-only">Trading fee</legend>
        <div className="flex gap-2.5">
          {FEE_TIERS.map((bps) => {
            const on = value.feeBps === bps;
            return (
              <button
                key={bps}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set("feeBps", bps)}
                className="tap flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] border transition-colors"
                style={
                  on
                    ? {
                        borderColor: "rgba(153,69,255,0.6)",
                        background: "rgba(153,69,255,0.12)",
                        boxShadow: "inset 0 0 0 1px rgba(153,69,255,0.35)",
                      }
                    : { borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }
                }
              >
                <span className="mono text-[18px] font-semibold">{bps / 100}%</span>
                <span className={`text-[11px] ${on ? "text-lavender" : "text-muted"}`}>
                  {pct((bps / 100) * 0.4, { decimals: 2, showSign: false })} to holders
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted" id="launch-pay-label">
            Pay with
          </span>
          <div className="flex gap-1.5" role="radiogroup" aria-labelledby="launch-pay-label">
            {payOptions.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={value.payWith === p}
                onClick={() => set("payWith", p)}
                className={`chip tap ${value.payWith === p ? "chip-on" : ""}`}
                style={{ height: 44, borderRadius: 12, padding: "0 16px" }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="launch-first-buy" className="text-xs font-semibold text-muted">
            First buy · min $1
          </label>
          <div className="field mono justify-between gap-2">
            <input
              id="launch-first-buy"
              inputMode="decimal"
              value={value.firstBuyUsd}
              onChange={(e) => set("firstBuyUsd", e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="25.00"
              className="mono w-full bg-transparent outline-none"
            />
            <span className="shrink-0 text-muted">{value.payWith}</span>
          </div>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        Fees are charged and paid out in {commoditySymbol} — holders of your market receive{" "}
        {pct((value.feeBps / 100) * 0.4, { decimals: 2, showSign: false })} of every trade in that commodity, every
        fifteen minutes.
      </p>
    </section>
  );
}
