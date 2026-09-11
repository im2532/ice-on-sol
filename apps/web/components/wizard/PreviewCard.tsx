"use client";

import { LAUNCH } from "@icemarkets/registry";
import { fmtPrice, pct, usd } from "@/lib/format";
import { swatch } from "@/lib/visual";
import type { CommodityQuote } from "@/lib/types";
import type { FeeState } from "./FeeAndBuy";

interface PreviewCardProps {
  name: string;
  ticker: string;
  imagePreview: string;
  commoditySymbol: string;
  commodity: CommodityQuote | null | undefined;
  fee: FeeState;
  /** Tokens the first buy mints, from the opening price. */
  youReceive?: number;
  submitting: boolean;
  connected: boolean;
  onLaunch: () => void;
}

function coinUnits(usdAmount: number, priceUsd: number | undefined): string | null {
  if (!priceUsd || priceUsd <= 0 || !Number.isFinite(usdAmount)) return null;
  return fmtPrice(usdAmount / priceUsd);
}

/** "Your market, as it will appear" — the sticky preview that mirrors the form as you fill it. */
export default function PreviewCard({
  name,
  ticker,
  imagePreview,
  commoditySymbol,
  commodity,
  fee,
  youReceive,
  submitting,
  connected,
  onLaunch,
}: PreviewCardProps) {
  const firstBuy = Number.parseFloat(fee.firstBuyUsd);
  const opensInCoin = coinUnits(LAUNCH.initialMarketCapUsd, commodity?.priceUsd);
  const firstBuyInCoin = coinUnits(firstBuy, commodity?.priceUsd);
  const holderPct = pct((fee.feeBps / 100) * 0.4, { decimals: 2, showSign: false });
  const displayTicker = ticker || "TICKER";

  return (
    <aside className="glass-strong flex flex-col gap-[18px] p-5 sm:p-[22px]" aria-label="Market preview">
      <span className="eyebrow">Your market, as it will appear</span>

      <div className="flex items-center gap-3.5">
        {imagePreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagePreview} alt="" className="h-14 w-14 shrink-0 rounded-[18px] object-cover" />
        ) : (
          <span
            className="h-14 w-14 shrink-0 rounded-[18px]"
            style={{ background: swatch(ticker || commoditySymbol), boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)" }}
            aria-hidden="true"
          />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="display truncate text-xl font-bold">{name || "Untitled market"}</span>
            <span className="mono text-[13px] text-positive">{displayTicker}</span>
          </div>
          <span className="chip" style={{ whiteSpace: "normal", height: "auto", paddingBlock: 4 }}>
            Paired with {commoditySymbol}
            {commodity ? ` · ${commodity.displayName ?? commodity.name}` : ""}
          </span>
        </div>
      </div>

      <dl className="mono grid grid-cols-2 gap-x-4 gap-y-2.5 border-y border-white/[0.08] py-3.5">
        <Cell k="Supply" v={LAUNCH.totalSupply.toLocaleString("en-US")} />
        <Cell
          k="Opens at"
          v={
            <>
              {usd(LAUNCH.initialMarketCapUsd, { decimals: 0 })}
              {opensInCoin && <span className="text-muted"> = {opensInCoin} {commoditySymbol}</span>}
            </>
          }
        />
        <Cell k="Graduates at" v={usd(LAUNCH.migrationMarketCapUsd, { decimals: 0 })} />
        <Cell
          k="Trading fee"
          v={
            <>
              {fee.feeBps / 100}% <span className="text-positive">· {holderPct} to holders</span>
            </>
          }
        />
        <Cell
          k="First buy"
          v={
            Number.isFinite(firstBuy) && firstBuy > 0 ? (
              <>
                {firstBuy} {fee.payWith}
                {firstBuyInCoin && ` → ${firstBuyInCoin} ${commoditySymbol}`}
              </>
            ) : (
              "—"
            )
          }
        />
        <Cell
          k="You receive"
          v={
            youReceive != null ? (
              <span className="text-positive">
                ≈ {youReceive.toLocaleString("en-US", { maximumFractionDigits: 0 })} {displayTicker}
              </span>
            ) : (
              "—"
            )
          }
        />
      </dl>

      <div className="mono flex flex-col gap-1.5 text-xs">
        <div className="flex justify-between gap-3">
          <span className="text-muted">Network cost</span>
          <span>≈ 0.025 SOL</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Creator share</span>
          <span className="text-right">none · fees go to holders</span>
        </div>
      </div>

      <button type="button" onClick={onLaunch} disabled={submitting} className="btn-primary tap h-[50px] w-full text-[15px]">
        {submitting ? "Confirm in wallet…" : connected ? `Launch ${displayTicker}` : "Connect wallet to launch"}
      </button>

      <p className="text-[11px] leading-relaxed text-muted">
        Commodity coins are synthetic and track a reference price via oracle. They are not redeemable for any
        physical asset, only against the protocol&apos;s USDC reserve, and may halt. Not available to US, UK
        or sanctioned persons.
      </p>
    </aside>
  );
}

function Cell({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="eyebrow">{k}</dt>
      <dd className="text-sm">{v}</dd>
    </div>
  );
}
