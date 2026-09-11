/**
 * Adapter over `@meteora-ag/dynamic-bonding-curve-sdk` v1.5.x. Every exact SDK field name
 * lives in THIS FILE ONLY (per docs/CONTRACTS.md §5: "launch.ts wraps them in one adapter
 * function so a rename is a one-line fix") — `launch.ts` and `trade.ts` never import the
 * Meteora SDK directly, they call through here.
 *
 * // CHECK vs SDK @meteora-ag/dynamic-bonding-curve-sdk ^1.5.12
 * Field names below are transcribed from docs/research/02-solana-launchpad-infra.md and
 * docs/CONTRACTS.md §5's parameter block, which were themselves read off the SDK source at
 * commit dated 7 Sep 2026 (see that doc). This package could not be installed in this
 * environment (no network access) so none of this has been compiled against the real
 * types. Before shipping: `pnpm add @meteora-ag/dynamic-bonding-curve-sdk@1.5.12`, then
 * fix whatever `tsc` flags here — it should be confined to this file.
 */
import { PublicKey, Connection, TransactionInstruction, Keypair } from "@solana/web3.js";
import BN from "bn.js";
import { PROGRAM_IDS, LAUNCH } from "@icemarkets/registry";

// CHECK vs SDK: exact export names / package path.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import {
  DynamicBondingCurveClient,
  buildCurveWithTwoSegments,
  // CHECK vs SDK: deriveDbcPoolAddress / derivePoolAuthority / deriveConfigAddress helper
  // names vary by SDK minor version; re-export whichever the pinned version provides.
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const DBC_PROGRAM_ID = new PublicKey(PROGRAM_IDS.dbc);

/**
 * DBC virtual-pool PDA: `["pool", config, max(base_mint, quote_mint), min(base_mint, quote_mint)]`
 * (bytewise key order, as in DBC `initialize_virtual_pool_with_spl_token`).
 * CHECK vs SDK: equals `deriveDbcPoolAddress(quoteMint, baseMint, config)` in
 * @meteora-ag/dynamic-bonding-curve-sdk — assert once the package is installed.
 */
export function deriveDbcPoolAddress(config: PublicKey, baseMint: PublicKey, quoteMint: PublicKey): PublicKey {
  const a = baseMint.toBuffer();
  const b = quoteMint.toBuffer();
  const [hi, lo] = Buffer.compare(a, b) >= 0 ? [a, b] : [b, a];
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), config.toBuffer(), hi, lo], DBC_PROGRAM_ID)[0];
}

/** Basis-point fee tiers the launch flow lets a creator pick from (CONTRACTS §5 / registry LAUNCH.feeTiersBps). */
export type FeeTierBps = (typeof LAUNCH.feeTiersBps)[number];

export interface BuildLaunchConfigParamsInput {
  /** USD price of one COIN (the quote token), e.g. GLD spot price — used to convert the
   *  fixed USD market-cap targets in CONTRACTS §5 into COIN-denominated curve inputs. */
  coinUsdPrice: number;
  feeTierBps: FeeTierBps;
  /** fee_router "router" PDA — becomes `feeClaimer` and receives 100% locked LP on migration. */
  routerPda: PublicKey;
  /** Where leftover / unsold curve tokens go if the curve doesn't fully sell out. */
  treasury: PublicKey;
  /** The COIN mint used as this launch's quote token (e.g. GLD, SLV, ...). */
  quoteMint: PublicKey;
}

/**
 * Builds the DBC config param block exactly as specified in CONTRACTS.md §5, via
 * `buildCurveWithTwoSegments`. Returns the object ready to pass to
 * `DynamicBondingCurveClient.partner.createConfig`.
 *
 * CHECK vs SDK: `buildCurveWithTwoSegments`'s parameter names/shape (in particular
 * `lockedVestingParam`, `baseFeeParams.feeSchedulerParam`, `migrationFee`,
 * `tokenUpdateAuthority` enum values, and whether `feeClaimer`/`leftoverReceiver`/
 * `quoteMint`/`enableFirstSwapWithMinFee`/`poolFeeBps` are top-level or nested under a
 * `curveConfig`/`poolConfig` wrapper) must be checked against the installed SDK version;
 * this transcribes CONTRACTS.md §5 verbatim.
 */
export function buildLaunchConfigParams(input: BuildLaunchConfigParamsInput) {
  const { coinUsdPrice, feeTierBps, routerPda, treasury, quoteMint } = input;
  if (coinUsdPrice <= 0) throw new Error("buildLaunchConfigParams: coinUsdPrice must be > 0");

  const initialMarketCap = LAUNCH.initialMarketCapUsd / coinUsdPrice; // in COIN units
  const migrationMarketCap = LAUNCH.migrationMarketCapUsd / coinUsdPrice; // in COIN units

  // CHECK vs SDK: buildCurveWithTwoSegments signature.
  return buildCurveWithTwoSegments({
    totalTokenSupply: LAUNCH.totalSupply,
    initialMarketCap,
    migrationMarketCap,
    percentageSupplyOnMigration: LAUNCH.percentageSupplyOnMigration,
    migrationOption: 1, // DAMM v2
    tokenBaseDecimal: 6,
    tokenQuoteDecimal: 6,
    lockedVestingParam: undefined, // none
    baseFeeParams: {
      feeSchedulerParam: {
        startingFeeBps: feeTierBps,
        endingFeeBps: feeTierBps,
        numberOfPeriod: 0,
        totalDuration: 0,
      },
    },
    dynamicFeeEnabled: false,
    activationType: 1, // timestamp
    collectFeeMode: 0, // quote (COIN)
    migrationFeeOption: LAUNCH.migrationFeeOption, // 6 = Customizable
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    partnerLpPercentage: 0,
    partnerLockedLpPercentage: 100,
    creatorLpPercentage: 0,
    creatorLockedLpPercentage: 0,
    creatorTradingFeePercentage: 0,
    leftover: 0,
    tokenUpdateAuthority: 1, // immutable
    feeClaimer: routerPda,
    leftoverReceiver: treasury,
    quoteMint,
    enableFirstSwapWithMinFee: true,
    poolFeeBps: feeTierBps,
  });
}

export interface DbcClientOpts {
  connection: Connection;
}

/** CHECK vs SDK: `new DynamicBondingCurveClient(connection, cluster?)` constructor shape. */
export function makeDbcClient(opts: DbcClientOpts): DynamicBondingCurveClient {
  return new DynamicBondingCurveClient(opts.connection);
}

export interface CreateConfigIxInput {
  client: DynamicBondingCurveClient;
  configKeypair: Keypair;
  payer: PublicKey;
  curveConfigParams: ReturnType<typeof buildLaunchConfigParams>;
}

/** CHECK vs SDK: `client.partner.createConfig(...)` argument names (`config`/`payer`/`params`). */
export async function createConfigIx(input: CreateConfigIxInput): Promise<TransactionInstruction[]> {
  const { client, configKeypair, payer, curveConfigParams } = input;
  const tx = await client.partner.createConfig({
    payer,
    config: configKeypair.publicKey,
    ...curveConfigParams,
  } as any);
  return extractIxs(tx);
}

export interface CreatePoolWithFirstBuyInput {
  client: DynamicBondingCurveClient;
  config: PublicKey;
  baseMintKeypair: Keypair;
  quoteMint: PublicKey;
  payer: PublicKey;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  /** First-buy amount, in quote (COIN) base units. */
  firstBuyQuoteAmount: BN;
  /** Minimum base (memecoin) tokens out of the first buy, for slippage protection. */
  firstBuyMinimumAmountOut: BN;
}

/**
 * CHECK vs SDK: `client.pool.createPoolWithFirstBuy` argument shape — in some SDK minor
 * versions this is two calls (`createPool` then `swap`) rather than one combined method;
 * confirm against the installed version and split this function if so.
 */
export async function createPoolWithFirstBuyIxs(input: CreatePoolWithFirstBuyInput): Promise<TransactionInstruction[]> {
  const { client, config, baseMintKeypair, quoteMint, payer, creator, name, symbol, uri, firstBuyQuoteAmount, firstBuyMinimumAmountOut } =
    input;
  const tx = await client.pool.createPoolWithFirstBuy({
    config,
    baseMint: baseMintKeypair.publicKey,
    quoteMint,
    payer,
    creator,
    name,
    symbol,
    uri,
    firstBuyParam: {
      quoteAmount: firstBuyQuoteAmount,
      minimumAmountOut: firstBuyMinimumAmountOut,
    },
  } as any);
  return extractIxs(tx);
}

export interface DbcSwapInput {
  client: DynamicBondingCurveClient;
  pool: PublicKey;
  owner: PublicKey;
  amountIn: BN;
  minimumAmountOut: BN;
  /** true = swap quote(COIN)->base(MEME); false = base(MEME)->quote(COIN). */
  swapBaseForQuote: boolean;
}

/** CHECK vs SDK: `client.pool.swap` (a.k.a. `swap2`) argument names and the instructions-sysvar
 *  requirement noted in docs/research/02 when the anti-sniper min-fee flag is set. */
export async function swapIx(input: DbcSwapInput): Promise<TransactionInstruction[]> {
  const { client, pool, owner, amountIn, minimumAmountOut, swapBaseForQuote } = input;
  const tx = await client.pool.swap({
    pool,
    owner,
    amountIn,
    minimumAmountOut,
    swapBaseForQuote,
  } as any);
  return extractIxs(tx);
}

export interface MigrateToDammV2Input {
  client: DynamicBondingCurveClient;
  pool: PublicKey;
  payer: PublicKey;
}

/** CHECK vs SDK: `client.migration.migrateToDammV2` argument shape; may return multiple txs
 *  (create position + lock liquidity as separate steps) rather than a single ix list. */
export async function migrateToDammV2Ixs(input: MigrateToDammV2Input): Promise<TransactionInstruction[]> {
  const { client, pool, payer } = input;
  const tx = await client.migration.migrateToDammV2({ dbcPool: pool, payer } as any);
  return extractIxs(tx);
}

/** CHECK vs SDK: `client.state.getPool` return shape (curve progress, is_migrated, partner fee fields). */
export async function getPoolState(client: DynamicBondingCurveClient, pool: PublicKey) {
  return client.state.getPool(pool);
}

/**
 * Normalizes whatever the SDK hands back (a `Transaction`, a `VersionedTransaction`, or a
 * raw `TransactionInstruction[]` — this varies by method and SDK minor version) into a
 * flat instruction array so callers can compose them into their own transaction(s).
 * CHECK vs SDK: confirm each method's actual return type and adjust extraction per call site
 * if some return VersionedTransaction (whose instructions live in a compiled message and
 * need `TransactionMessage.decompile` plus an `AddressLookupTableAccount[]`, not a plain array).
 */
function extractIxs(tx: unknown): TransactionInstruction[] {
  if (Array.isArray(tx)) return tx as TransactionInstruction[];
  const t = tx as { instructions?: TransactionInstruction[] };
  if (t?.instructions) return t.instructions;
  throw new Error("dbc.ts: unrecognized transaction shape returned by SDK — see extractIxs CHECK note");
}
