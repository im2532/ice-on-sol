/**
 * Environment parsing for the keeper. Manual validation (no zod) per the task spec —
 * fail fast and loud on boot rather than deep in a cycle. Field names mirror
 * `.env.example` at the repo root.
 */
import "dotenv/config";

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

export type Cluster = "localnet" | "devnet" | "mainnet-beta";

function parseCluster(name: string, fallback: Cluster): Cluster {
  const v = optional(name, fallback);
  if (v !== "localnet" && v !== "devnet" && v !== "mainnet-beta") {
    throw new ConfigError(`Env var ${name} must be one of localnet|devnet|mainnet-beta, got: ${v}`);
  }
  return v;
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
  usdcMint: string;

  hermesUrl: string;
  switchboardQueue: string | undefined;
  pricempireApiKey: string | undefined;
  csfloatApiKey: string | undefined;
  pokemonTcgApiKey: string | undefined;
  dataVendorApiKey: string | undefined;

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

  const cfg: KeeperConfig = {
    cluster: parseCluster("SOLANA_CLUSTER", "devnet"),
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
    usdcMint: required("USDC_MINT"),

    hermesUrl: optional("HERMES_URL", "https://hermes.pyth.network"),
    switchboardQueue: process.env.SWITCHBOARD_QUEUE,
    pricempireApiKey: process.env.PRICEMPIRE_API_KEY,
    csfloatApiKey: process.env.CSFLOAT_API_KEY,
    pokemonTcgApiKey: process.env.POKEMONTCG_API_KEY,
    dataVendorApiKey: process.env.DATA_VENDOR_API_KEY,

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
