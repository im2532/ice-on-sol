/**
 * Environment parsing for the keeper. Manual validation (no zod) per the task spec —
 * fail fast and loud on boot rather than deep in a cycle. Field names mirror
 * `.env.example` at the repo root.
 */
import "dotenv/config";
import { parseCluster as parseClusterValue, usdcMintFor, type Cluster } from "@icemarkets/registry";

export type { Cluster };

export class ConfigError extends Error {}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new ConfigError(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || v.trim() === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new ConfigError(`Env var ${name} must be an integer, got: ${v}`);
  return n;
}

function optionalFloat(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || v.trim() === "") return fallback;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) throw new ConfigError(`Env var ${name} must be a number, got: ${v}`);
  return n;
}

function parseCluster(name: string, fallback: Cluster): Cluster {
  try {
    return parseClusterValue(process.env[name], fallback);
  } catch (err) {
    throw new ConfigError(`Env var ${name}: ${(err as Error).message}`);
  }
}

/** USDC by cluster from the registry `USDC` map; `USDC_MINT_OVERRIDE` wins (required on localnet). */
function resolveUsdcMint(cluster: Cluster): string {
  let mint: string;
  try {
    mint = usdcMintFor(cluster, process.env.USDC_MINT_OVERRIDE);
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
  // Legacy v0.1 `USDC_MINT` is no longer read; refuse a stale value that disagrees with the cluster
  // (the v0.1 .env.example paired devnet with the mainnet mint).
  const legacy = process.env.USDC_MINT?.trim();
  if (legacy && legacy !== mint) {
    throw new ConfigError(`USDC_MINT=${legacy} does not match ${cluster} USDC ${mint}; delete it (or rename to USDC_MINT_OVERRIDE to force a custom mint)`);
  }
  return mint;
}

export interface KeeperConfig {
  cluster: Cluster;
  rpcUrl: string;
  wsUrl: string | undefined;
  keeperKeypairPath: string;

  pegDeskProgramId: string;
  feeRouterProgramId: string;
  distributorProgramId: string;
  buybackProgramId: string;
  dbcProgramId: string;
  dammV2ProgramId: string;
  pythReceiverProgramId: string;
  /** Resolved from SOLANA_CLUSTER via `@icemarkets/registry` USDC (override: USDC_MINT_OVERRIDE). */
  usdcMint: string;

  hermesUrl: string;
  /** Pyth API key: Hermes price endpoints require `Authorization: Bearer` since 2026-08-26. */
  pythApiKey: string | undefined;
  switchboardQueue: string | undefined;
  pricempireApiKey: string | undefined;
  csfloatApiKey: string | undefined;
  pokemonTcgApiKey: string | undefined;
  dataVendorApiKey: string | undefined;
  /** Helius API key; also doubles for the DAS `getAssetsByGroup` call and Enhanced Transactions lookups in sources/collectorcrypt.ts. */
  heliusApiKey: string | undefined;
  /** watches category: sources/watches.ts WatchCharts lookup. */
  watchChartsApiKey: string | undefined;
  /** watches + trading_cards categories: sources/collectorcrypt.ts — the vault collection's on-chain group address (Helius DAS `getAssetsByGroup`). */
  collectorCryptCollection: string | undefined;
  /** Optional: a Collector Crypt REST API base URL, used as a fallback if the Helius DAS path is unavailable/fails. */
  collectorCryptApiUrl: string | undefined;

  oraclePushIntervalSec: number;
  feeCycleIntervalSec: number;
  payoutMinPoolUsd: number;
  payoutMinHoldingUsd: number;
  payoutMinAmountUsd: number;
  sessionCycleIntervalSec: number;
  migrateCycleIntervalSec: number;
  buybackCycleIntervalSec: number;

  databaseUrl: string;
  healthzPort: number;

  jitoBundleUrl: string | undefined;
  priorityMicroLamports: number;
  computeUnitLimit: number;
}

let cached: KeeperConfig | null = null;

/** Loads and validates the keeper's environment. Throws `ConfigError` with a clear message on any problem. */
export function loadConfig(): KeeperConfig {
  if (cached) return cached;

  const cluster = parseCluster("SOLANA_CLUSTER", "devnet");
  const cfg: KeeperConfig = {
    cluster,
    rpcUrl: required("RPC_URL"),
    wsUrl: process.env.WS_URL,
    keeperKeypairPath: required("KEEPER_KEYPAIR_PATH"),

    pegDeskProgramId: required("PEG_DESK_PROGRAM_ID"),
    feeRouterProgramId: required("FEE_ROUTER_PROGRAM_ID"),
    distributorProgramId: required("DISTRIBUTOR_PROGRAM_ID"),
    buybackProgramId: required("BUYBACK_PROGRAM_ID"),
    dbcProgramId: required("DBC_PROGRAM_ID"),
    dammV2ProgramId: required("DAMM_V2_PROGRAM_ID"),
    pythReceiverProgramId: required("PYTH_RECEIVER_PROGRAM_ID"),
    usdcMint: resolveUsdcMint(cluster),

    hermesUrl: optional("HERMES_URL", "https://hermes.pyth.network"),
    pythApiKey: process.env.PYTH_API_KEY || undefined,
    switchboardQueue: process.env.SWITCHBOARD_QUEUE,
    pricempireApiKey: process.env.PRICEMPIRE_API_KEY,
    csfloatApiKey: process.env.CSFLOAT_API_KEY,
    pokemonTcgApiKey: process.env.POKEMONTCG_API_KEY,
    dataVendorApiKey: process.env.DATA_VENDOR_API_KEY,
    heliusApiKey: process.env.HELIUS_API_KEY,
    watchChartsApiKey: process.env.WATCHCHARTS_API_KEY,
    collectorCryptCollection: process.env.COLLECTORCRYPT_COLLECTION,
    collectorCryptApiUrl: process.env.COLLECTORCRYPT_API_URL,

    oraclePushIntervalSec: optionalInt("ORACLE_PUSH_INTERVAL", 30),
    feeCycleIntervalSec: optionalInt("FEE_CYCLE_INTERVAL", 900),
    payoutMinPoolUsd: optionalFloat("PAYOUT_MIN_POOL_USD", 100),
    payoutMinHoldingUsd: optionalFloat("PAYOUT_MIN_HOLDING_USD", 5),
    payoutMinAmountUsd: optionalFloat("PAYOUT_MIN_AMOUNT_USD", 1),
    sessionCycleIntervalSec: optionalInt("SESSION_CYCLE_INTERVAL", 15),
    migrateCycleIntervalSec: optionalInt("MIGRATE_CYCLE_INTERVAL", 60),
    buybackCycleIntervalSec: optionalInt("BUYBACK_CYCLE_INTERVAL", 900),

    databaseUrl: required("DATABASE_URL"),
    healthzPort: optionalInt("HEALTHZ_PORT", 8787),

    jitoBundleUrl: process.env.JITO_BUNDLE_URL,
    priorityMicroLamports: optionalInt("PRIORITY_MICROLAMPORTS", 10_000),
    computeUnitLimit: optionalInt("COMPUTE_UNIT_LIMIT", 400_000),
  };

  cached = cfg;
  return cfg;
}
