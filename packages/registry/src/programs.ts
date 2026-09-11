/** Program ids and well-known addresses. Placeholders are replaced by scripts/write-program-ids.ts after deploy. */
export const PROGRAM_IDS = {
  pegDesk: "PegDesk111111111111111111111111111111111111",
  feeRouter: "FeeRoutr111111111111111111111111111111111111",
  distributor: "Distrib1111111111111111111111111111111111111",
  buyback: "Buyback1111111111111111111111111111111111111",
  // external
  dbc: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  dammV2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  pythReceiver: "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
  tokenMetadata: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
} as const;

export const USDC = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const;

/** PDA seeds — must match each program's `src/constants.rs` exactly. */
export const SEEDS = {
  pegDesk: { config: "config", commodity: "cmdty", reserve: "reserve", hedge: "hedge", keeperPrice: "kp", mintAuth: "mint_auth" },
  feeRouter: { router: "router", holderVault: "holder_vault", buybackVault: "buyback_vault", treasury: "treasury", poolState: "pool" },
  distributor: { config: "dist", authority: "dist_auth", epoch: "epoch", claimed: "claimed" },
  buyback: { state: "buyback", authority: "bb_auth" },
} as const;

/** Fee split of ICEmarkets's 80% share of gross trading fees (Meteora keeps a fixed 20%). Sums to 10_000. */
export const FEE_SPLIT_BPS = { holders: 5000, buyback: 2500, protocol: 2500 } as const;

/** Launch economics (USD at config creation; converted to COIN units by the launch builder). */
export const LAUNCH = {
  totalSupply: 1_000_000_000,
  initialMarketCapUsd: 5_000,
  migrationMarketCapUsd: 35_000,
  percentageSupplyOnMigration: 20,
  feeTiersBps: [100, 200, 300] as const,
  migrationFeeOption: 6, // Customizable → fee = tier, collect in quote
  minFirstBuyUsd: 1,
} as const;

export const PAYOUT = { cycleSec: 900, minPoolUsd: 100, minHoldingUsd: 5, minPayoutUsd: 1 } as const;
