"use client";

import { usd } from "@/lib/format";
import type { PayWith } from "@/lib/actions";

const FEE_TIERS = [
  { bps: 100, label: "1%" },
  { bps: 200, label: "2%" },
  { bps: 300, label: "3%" },
] as const;

export interface FeeState {
  feeBps: 100 | 200 | 300;
  payWith: Extract<PayWith, "USDC" | "SOL">;
  firstBuyUsd: string;
}

interface Step3Props {
  value: FeeState;
  onChange: (next: FeeState) => void;
  commoditySymbol: string;
  youReceive?: number;
}

export default function Step3Fee({ value, onChange, commoditySymbol, youReceive }: Step3Props) {
  const set = <K extends keyof FeeState>(key: K, v: FeeState[K]) => onChange({ ...value, [key]: v });
  const holdersUsd = value.feeBps ? (value.feeBps / 100) * 0.4 : 0;
  const iceUsd = value.feeBps ? (value.feeBps / 100) * 0.2 : 0;
  const protocolUsd = value.feeBps ? (value.feeBps / 100) * 0.2 : 0;
  const meteoraUsd = value.feeBps ? (value.feeBps / 100) * 0.2 : 0;

  return (
    <div>
      <fieldset className="mb-5">
        <legend className="mb-2 text-xs font-medium text-muted">Trading fee</legend>
        <div className="grid grid-cols-3 gap-2">
          {FEE_TIERS.map((t) => (
            <label
              key={t.bps}
              className={`icemarkets-focus flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-3 py-3 text-center ${
                value.feeBps === t.bps ? "border-green/50 bg-green/10" : "border-border hover:border-purple/40"
              }`}
            >
              <input
                type="radio"
                name="fee-tier"
                className="sr-only"
                checked={value.feeBps === t.bps}
                onChange={() => set("feeBps", t.bps)}
              />
              <span className="font-nums text-lg font-semibold">{t.label}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-4">
          <span>Holders {holdersUsd.toFixed(2)}%</span>
          <span>$ICE burn {iceUsd.toFixed(2)}%</span>
          <span>Protocol {protocolUsd.toFixed(2)}%</span>
          <span>Meteora {meteoraUsd.toFixed(2)}%</span>
        </div>
      </fieldset>

      <fieldset className="mb-5">
        <legend className="mb-2 text-xs font-medium text-muted">Pay with</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Pay with">
          {(["USDC", "SOL"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={value.payWith === p}
              onClick={() => set("payWith", p)}
              className={`icemarkets-focus rounded-lg border px-4 py-2 text-sm font-medium ${
                value.payWith === p ? "border-green/50 bg-green/10 text-green" : "border-border text-muted hover:text-text"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="first-buy" className="mb-1.5 block text-xs font-medium text-muted">
          First buy (min $1)
        </label>
        <div className="flex items-center rounded-lg border border-border bg-surface2 px-3 py-2.5">
          <span className="mr-1 text-sm text-muted">$</span>
          <input
            id="first-buy"
            inputMode="decimal"
            value={value.firstBuyUsd}
            onChange={(e) => set("firstBuyUsd", e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="1.00"
            className="icemarkets-focus w-full bg-transparent font-nums text-sm outline-none"
          />
          <span className="text-xs text-muted">{value.payWith}</span>
        </div>
        <p className="mt-2 text-xs text-muted">
          You receive ≈{" "}
          <span className="font-nums text-text">
            {youReceive != null ? youReceive.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
          </span>{" "}
          of your coin, first buy in {value.payWith}. Fees pay out in {commoditySymbol}.
        </p>
      </div>
    </div>
  );
}
