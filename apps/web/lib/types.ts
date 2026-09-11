/** Shapes returned by the indexer API (apps/indexer) — see docs/CONTRACTS.md §5 for table sources. */

export type MarketStatus = "open" | "closed" | "halted";

export interface Market {
  mint: string;
  ticker: string;
  name: string;
  image: string;
  commoditySymbol: string;
  commodityEmoji: string;
  commodityName: string;
  pairedWith: string; // e.g. "GLD" or "PMX (basket)"
  fdvUsd: number;
  priceQuote: number; // price in the paired coin
  priceUsd: number;
  change24h: number;
  volume24hUsd: number;
  curveProgressPct: number; // 0-100, DBC completion
  migrated: boolean;
  createdAt: string;
  feeBps: number;
  creator: string;
  dbcPool: string;
  dammPool?: string;
  holderEarningsCoin: number;
}

export interface CommodityQuote {
  symbol: string;
  name: string;
  displayName?: string;
  category: string;
  emoji: string;
  unit: string;
  unitShort: string;
  priceUsd: number;
  change24h: number;
  marketsCount: number;
  status: MarketStatus;
  lastPublishedAgoSec: number;
  supplyCap: number;
  supplyOutstanding: number;
  reserveRatioBps: number;
  mint: string;
}

export interface PricePoint {
  ts: number; // unix seconds
  price: number;
}

export interface Candle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Trade {
  sig: string;
  ts: number;
  side: "buy" | "sell";
  baseAmount: number;
  quoteAmount: number;
  priceQuote: number;
  priceUsd: number;
  trader: string;
}

export interface LeaderboardRow {
  rank: number;
  mint: string;
  ticker: string;
  name: string;
  image: string;
  pairedWith: string;
  pairedEmoji: string;
  feeAmountCoin: number;
  feeCoinSymbol: string;
  holderShareUsd: number;
}

/** One holder payout from the "Holder rewards" live feed (GET /rewards/payouts). */
export interface Payout {
  id: string;
  wallet: string;
  mint: string;
  /** Market ticker the payout came from. */
  ticker: string;
  /** Commodity coin the reward is paid in. */
  commoditySymbol: string;
  amount: number;
  ts: number; // unix seconds
}

export interface WalletRewards {
  wallet: string;
  totalEarnedUsd: number;
  byCoin: { symbol: string; emoji: string; amount: number; claimable: number }[];
}

export interface GlobalStats {
  marketsCount: number;
  commoditiesCount: number;
  volume24hUsd: number;
  valueLockedUsd: number;
  paidToHoldersUsd: number;
  paidToHolders24hUsd: number;
  holderWallets: number;
  iceBoughtBackUsd: number;
  iceBurned: number;
  iceBurnedPct: number;
  iceMcapUsd: number;
  icePriceGld: number;
}

/** One unclaimed distributor Merkle leaf (GET /rewards/:wallet/claims) — input for the `claim` ix. */
export interface ClaimableLeaf {
  pool: string; // DBC pool (Epoch seed)
  epochIndex: number;
  epoch: string; // Epoch PDA
  coinMint: string;
  coinSymbol: string;
  amount: string; // base units, exact u64 as string
  proof: string[]; // hex, leaf -> root
}
