/**
 * Shared vocabulary for every ICEmarkets component. The on-chain `peg_desk` program,
 * the keeper, the indexer and the web app all read from this registry, so a
 * change here is a protocol change — bump `REGISTRY_VERSION` and run `validate`.
 */

export const REGISTRY_VERSION = 1;

export type Category =
  | "metals"
  | "energy"
  | "agriculture"
  | "livestock"
  | "fast_food"
  | "cs2_skins"
  | "game_gold"
  | "trading_cards"
  | "water"
  | "cars"
  | "watches";

/** Mirrors `OracleKind` in programs/peg_desk/src/state.rs (same discriminants). */
export enum OracleKind {
  /** Pyth pull oracle; keeper posts a PriceUpdateV2 account the program reads. */
  PythPull = 0,
  /** Switchboard On-Demand feed (TEE-signed HTTP job). */
  Switchboard = 1,
  /** Multisig-signed price with bounded moves; for slow / manual sources. */
  KeeperSigned = 2,
  /** Weighted basket of other commodities (index coin). */
  Composite = 3,
}

/** Trading-session model. Mirrors `SessionKind` in the program. */
export enum SessionKind {
  /** Trades 24/7 with a single max_age. */
  Continuous = 0,
  /** CME Globex-style: Sun 18:00 ET – Fri 17:00 ET with 17:00–18:00 daily break. */
  CmeGlobex = 1,
  /** ICE US softs: roughly 04:00–14:00 ET weekdays. */
  IceUs = 2,
  /** LME: 01:00–19:00 London weekdays. */
  Lme = 3,
  /** Slow / manual data; always "open", relies on long max_age. */
  Slow = 4,
}

export type Tier = "A24" | "AHours" | "B" | "C";

export interface OracleSpec {
  kind: OracleKind;
  /** Pyth: Hermes symbol (resolved to feed id at seed time when `feedId` is null). */
  pythSymbol?: string;
  /** Pyth: 32-byte hex feed id, if pinned. */
  feedId?: string | null;
  /** Pyth: quote currency of the feed. Program converts to USD via `fxFeedId` when not USD. */
  quote?: "USD" | "USc" | "EUR";
  /** Pyth feed id for EUR/USD when quote is EUR. */
  fxFeedId?: string;
  /** Switchboard: human description of the job; jobs live in apps/keeper/src/oracles/switchboard/jobs/*.json */
  switchboardJob?: string;
  /** KeeperSigned: expected update cadence in seconds (informational; program only enforces max_age). */
  cadenceSec?: number;
  /** Composite: legs. Weights in bps, sum to 10_000. */
  legs?: { symbol: string; weightBps: number }[];
}

export interface Commodity {
  /** On-chain symbol (≤ 12 ASCII chars), also the SPL token symbol. */
  symbol: string;
  name: string;
  category: Category;
  /** Quantity one coin represents, e.g. "1 oz", "1 bbl", "1 item". */
  unit: string;
  unitShort: string;
  tier: Tier;
  session: SessionKind;
  oracle: OracleSpec;
  /** Risk parameters seeded into the `Commodity` account (bps unless noted). */
  params: {
    baseSpreadBps: number;
    closedSpreadBps: number;
    /** Multiplier on Pyth confidence/price added to spread (bps per 1% conf). */
    confMultBps: number;
    maxAgeOpenSec: number;
    maxAgeClosedSec: number;
    /** Hard cap on outstanding supply, in USD at launch (program stores coin units after seed). */
    supplyCapUsd: number;
    perTxCapUsd: number;
  };
  /** Which launch phase this coin ships in. */
  phase: "mvp";  // single release — no phases
  /** Trademark-safe display name if the underlying product is a brand. */
  displayName?: string;
  emoji: string;
}
