"use client";

import { Button } from "@/components/agentic/Button";
import { LAUNCH } from "@icemarkets/registry";
import { fmtPrice, pct, usd } from "@/lib/format";
import type { CommodityQuote } from "@/lib/types";
import type { FeeState } from "./FeeAndBuy";
import CommodityLogo from "@/components/CommodityLogo";

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

function coinUnits(
  usdAmount: number,
  priceUsd: number | undefined,
): string | null {
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
  const opensInCoin = coinUnits(
    LAUNCH.initialMarketCapUsd,
    commodity?.priceUsd,
  );
  const firstBuyInCoin = coinUnits(firstBuy, commodity?.priceUsd);
  const holderPct = pct((fee.feeBps / 100) * 0.4, {
    decimals: 2,
    showSign: false,
  });
  const displayTicker = ticker || "TICKER";

  return (
    <aside
      className="glass-strong flex flex-col gap-[18px] p-5 sm:p-[22px]"
      aria-label="Market preview"
    >
      <div className="preview-identity">
        {imagePreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagePreview} alt="" className="preview-avatar" />
        ) : (
          <span className="preview-avatar preview-brand-avatar" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M9 5h14l6 9-13 14L3 14l6-9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M3 14h26M9 5l7 23L23 5M9 5l7 9 7-9" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </span>
        )}
        <div className="preview-identity-copy">
          <span className="display preview-market-name">{name || "Untitled market"}</span>
          <div className="preview-identity-meta">
            <span className="preview-ticker">{displayTicker}</span>
          <span className="preview-pair-chip" title={`Paired with ${commoditySymbol} · ${commodity?.displayName ?? commodity?.name ?? commoditySymbol}`}>
            <CommodityLogo symbol={commoditySymbol} size={14} />
            <span>Paired with {commodity?.displayName ?? commodity?.name ?? commoditySymbol}</span>
          </span>
          </div>

        </div>
      </div>


      <dl className="preview-details">
        <Cell k="Supply" v={LAUNCH.totalSupply.toLocaleString("en-US")} />
        <Cell
          k="Opens at"
          v={
            <>
              {usd(LAUNCH.initialMarketCapUsd, { decimals: 0 })}
              {opensInCoin && (
                <span className="text-muted">
                  {" "}
                  = {opensInCoin} {commoditySymbol}
                </span>
              )}
            </>
          }
        />
        <Cell
          k="Graduates at"
          v={usd(LAUNCH.migrationMarketCapUsd, { decimals: 0 })}
        />
        <Cell
          k="Trading fee"
          v={
            <>
              {fee.feeBps / 100}%{" "}
              <span className="text-positive">· {holderPct} to holders</span>
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
                ≈{" "}
                {youReceive.toLocaleString("en-US", {
                  maximumFractionDigits: 0,
                })}{" "}
                {displayTicker}
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

      <Button
        plain
        type="button"
        onClick={onLaunch}
        disabled={submitting}
        className="btn-primary tap h-[50px] w-full text-[15px]"
      >
        {submitting
          ? "Confirm in wallet…"
          : connected
            ? `Launch ${displayTicker}`
            : "Connect wallet to launch"}
      </Button>

      <p className="text-[11px] leading-relaxed text-muted">
        Commodity coins are synthetic and track a reference price via oracle.
        They are not redeemable for any physical asset, only against the
        protocol&apos;s USDC reserve, and may halt. Not available to US, UK or
        sanctioned persons.
      </p>
    </aside>
  );
}

function Cell({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="preview-detail-row">
      <dt className="eyebrow">{k}</dt>
      <dd className="text-sm">{v}</dd>
    </div>
  );
}
