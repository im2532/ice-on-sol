/**
 * Peg Desk circuit-breaker defaults by risk tier. Applied on-chain by `scripts/set-breakers.ts`
 * (`set_commodity_params`); the program stores absolute caps, so the percentages here are turned
 * into base units against each commodity's `supply_cap` / registry `supplyCapUsd` at apply time.
 *
 * Rationale (docs/MAINNET_PLAN.md §2, §5): the spread is the only thing between a bad oracle
 * print and the USDC reserve, so every coin gets (a) a bound on how far a trade price may jump
 * from the last accepted one while that anchor is fresh, and (b) a rolling 24 h cap on minting
 * and on USDC redemptions. Keeper-signed coins are the least trusted feed and get the tightest caps.
 */
import type { Tier } from "./types";

export interface BreakerDefaults {
  /** Max |oracle − last accepted price| in bps while the anchor is younger than `deviationWindowSecs`. */
  maxDeviationBps: number;
  /** How long a trade's oracle read stays the deviation anchor. */
  deviationWindowSecs: number;
  /** Rolling-24h mint cap as a fraction of `supply_cap` (coin units), in bps of the cap. */
  dailyMintCapBpsOfSupplyCap: number;
  /** Rolling-24h redemption cap as a fraction of `supplyCapUsd` (USDC units), in bps. */
  dailyRedeemCapBpsOfSupplyCapUsd: number;
}

export const BREAKER_DEFAULTS: Record<Tier, BreakerDefaults> = {
  // Pyth majors, 24/7 or exchange-hours: liquid, well-sourced. 3% intra-window jumps are rare
  // outside of scheduled data releases, where the keeper closes the market anyway.
  A24: { maxDeviationBps: 300, deviationWindowSecs: 900, dailyMintCapBpsOfSupplyCap: 2_500, dailyRedeemCapBpsOfSupplyCapUsd: 2_500 },
  AHours: { maxDeviationBps: 400, deviationWindowSecs: 900, dailyMintCapBpsOfSupplyCap: 2_500, dailyRedeemCapBpsOfSupplyCapUsd: 2_500 },
  // Thinner futures (livestock, softs, lumber): limit-up/down days exist, so a wider bound but a
  // smaller daily budget.
  B: { maxDeviationBps: 600, deviationWindowSecs: 900, dailyMintCapBpsOfSupplyCap: 1_500, dailyRedeemCapBpsOfSupplyCapUsd: 1_500 },
  // Keeper-signed collectibles / menu prices: the keeper key is the oracle. Tightest daily budget;
  // the per-post bound (KeeperPrice.max_move_bps) still applies on top.
  C: { maxDeviationBps: 800, deviationWindowSecs: 1_800, dailyMintCapBpsOfSupplyCap: 1_000, dailyRedeemCapBpsOfSupplyCapUsd: 1_000 },
};

/** Absolute caps for one commodity, in base units (coin 6 dp, USDC 6 dp). */
export function breakerCaps(
  tier: Tier,
  supplyCapCoinBase: bigint,
  supplyCapUsd: number,
): { dailyMintCap: bigint; dailyRedeemCap: bigint; maxDeviationBps: number; deviationWindowSecs: number } {
  const d = BREAKER_DEFAULTS[tier];
  const usdcBase = BigInt(Math.round(supplyCapUsd)) * 1_000_000n;
  return {
    dailyMintCap: (supplyCapCoinBase * BigInt(d.dailyMintCapBpsOfSupplyCap)) / 10_000n,
    dailyRedeemCap: (usdcBase * BigInt(d.dailyRedeemCapBpsOfSupplyCapUsd)) / 10_000n,
    maxDeviationBps: d.maxDeviationBps,
    deviationWindowSecs: d.deviationWindowSecs,
  };
}
