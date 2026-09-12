/**
 * Adapter over `@meteora-ag/dynamic-bonding-curve-sdk` v1.5.x. Every exact SDK field name
 * lives in THIS FILE ONLY (per docs/CONTRACTS.md §5: "launch.ts wraps them in one adapter
 * function so a rename is a one-line fix") — `launch.ts` and `trade.ts` never import the
 * Meteora SDK directly, they call through here.
 *
 * Compiled against @meteora-ag/dynamic-bonding-curve-sdk 1.5.12 (typecheck passes). The
 * CONTRACTS.md §5 parameter block is flat; 1.5.x nests it into
 * `{ token, fee, migration, liquidityDistribution, lockedVesting, activationType }` and moves
 * `feeClaimer` / `leftoverReceiver` / `quoteMint` onto `partner.createConfig`.
 */
import { PublicKey, Connection, TransactionInstruction, Keypair, Commitment, ComputeBudgetProgram } from "@solana/web3.js";
import BN from "bn.js";
import { PROGRAM_IDS, LAUNCH } from "@icemarkets/registry";

import {
  DynamicBondingCurveClient,
  buildCurveWithTwoSegments,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DammV2DynamicFeeMode,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  SwapMode,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  type CreateConfigParams,
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
  /** Overrides for LAUNCH.initialMarketCapUsd / migrationMarketCapUsd (localnet/devnet loop tests that
   *  need a cheap migration; production launches use the registry defaults). */
  initialMarketCapUsd?: number;
  migrationMarketCapUsd?: number;
}

/** Everything `partner.createConfig` needs except the per-launch `config` keypair and `payer`. */
export type LaunchConfigParams = Omit<CreateConfigParams, "config" | "payer">;

/**
 * Builds the DBC config param block specified in CONTRACTS.md §5 via `buildCurveWithTwoSegments`,
 * plus the three account fields (`feeClaimer`, `leftoverReceiver`, `quoteMint`) that the SDK takes
 * on `createConfig` rather than in the curve builder. Spread the result into `createConfigIx`.
 */
export function buildLaunchConfigParams(input: BuildLaunchConfigParamsInput): LaunchConfigParams {
  const { coinUsdPrice, feeTierBps, routerPda, treasury, quoteMint } = input;
  if (coinUsdPrice <= 0) throw new Error("buildLaunchConfigParams: coinUsdPrice must be > 0");

  const initialMarketCap = (input.initialMarketCapUsd ?? LAUNCH.initialMarketCapUsd) / coinUsdPrice; // in COIN units
  const migrationMarketCap = (input.migrationMarketCapUsd ?? LAUNCH.migrationMarketCapUsd) / coinUsdPrice; // in COIN units

  const configParameters = buildCurveWithTwoSegments({
    initialMarketCap,
    migrationMarketCap,
    percentageSupplyOnMigration: LAUNCH.percentageSupplyOnMigration,
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.SIX,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: LAUNCH.totalSupply,
      leftover: LAUNCH.leftoverTokens, // absorbs the builder's rounding delta; see registry LAUNCH
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: feeTierBps,
          endingFeeBps: feeTierBps,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken, // fees in COIN
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: true,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable, // LAUNCH.migrationFeeOption (6)
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      // Customizable ⇒ the migrated DAMM v2 pool's fee is set here: same tier, collected in quote.
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Disabled,
        poolFeeBps: feeTierBps,
      },
    },
    liquidityDistribution: {
      // 100% of migrated LP permanently locked to the partner (fee_router's router PDA).
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
  });

  return { ...configParameters, feeClaimer: routerPda, leftoverReceiver: treasury, quoteMint };
}

export interface DbcClientOpts {
  connection: Connection;
  commitment?: Commitment;
}

export function makeDbcClient(opts: DbcClientOpts): DynamicBondingCurveClient {
  return new DynamicBondingCurveClient(opts.connection, opts.commitment ?? "confirmed");
}

export interface CreateConfigIxInput {
  client: DynamicBondingCurveClient;
  configKeypair: Keypair;
  payer: PublicKey;
  curveConfigParams: LaunchConfigParams;
}

/** `partner.createConfig`; the returned ixs need `configKeypair` as a signer. */
export async function createConfigIx(input: CreateConfigIxInput): Promise<TransactionInstruction[]> {
  const { client, configKeypair, payer, curveConfigParams } = input;
  const tx = await client.partner.createConfig({
    payer,
    config: configKeypair.publicKey,
    ...curveConfigParams,
  });
  return extractIxs(tx);
}

export interface CreatePoolWithFirstBuyInput {
  client: DynamicBondingCurveClient;
  config: PublicKey;
  baseMintKeypair: Keypair;
  /** Not needed by the SDK call (read from the config account); kept for symmetry with the launch flow. */
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

export interface CreateConfigAndPoolWithFirstBuyInput extends CreatePoolWithFirstBuyInput {
  curveConfigParams: LaunchConfigParams;
}

/**
 * Config + pool + first buy for the one-transaction launch. `creator.createPoolWithFirstBuy` cannot be
 * used there: it fetches the pool config from chain, which does not exist yet inside the same
 * transaction. `partner.createConfigAndPoolWithFirstBuy` builds both from the params instead and
 * returns them as two transactions; the caller concatenates the instructions. `configKeypair` and
 * `baseMintKeypair` must both sign.
 */
export async function createConfigAndPoolWithFirstBuyIxs(
  input: CreateConfigAndPoolWithFirstBuyInput,
): Promise<{ configIxs: TransactionInstruction[]; poolIxs: TransactionInstruction[] }> {
  const { client, config, curveConfigParams, baseMintKeypair, payer, creator, name, symbol, uri, firstBuyQuoteAmount, firstBuyMinimumAmountOut } = input;
  const { createConfigTx, createPoolWithFirstBuyTx } = await client.partner.createConfigAndPoolWithFirstBuy({
    payer,
    config,
    ...curveConfigParams,
    preCreatePoolParam: { name, symbol, uri, poolCreator: creator, baseMint: baseMintKeypair.publicKey },
    firstBuyParam: {
      buyer: creator,
      buyAmount: firstBuyQuoteAmount,
      minimumAmountOut: firstBuyMinimumAmountOut,
      referralTokenAccount: null,
    },
  });
  return { configIxs: extractIxs(createConfigTx), poolIxs: extractIxs(createPoolWithFirstBuyTx) };
}

/**
 * `creator.createPoolWithFirstBuy` for a config that ALREADY exists on chain (the SDK fetches it).
 * For the one-transaction launch use `createConfigAndPoolWithFirstBuyIxs`. `baseMintKeypair` must sign.
 */
export async function createPoolWithFirstBuyIxs(input: CreatePoolWithFirstBuyInput): Promise<TransactionInstruction[]> {
  const { client, config, baseMintKeypair, payer, creator, name, symbol, uri, firstBuyQuoteAmount, firstBuyMinimumAmountOut } = input;
  const tx = await client.creator.createPoolWithFirstBuy({
    createPoolParam: {
      name,
      symbol,
      uri,
      payer,
      poolCreator: creator,
      config,
      baseMint: baseMintKeypair.publicKey,
    },
    firstBuyParam: {
      buyer: creator,
      buyAmount: firstBuyQuoteAmount,
      minimumAmountOut: firstBuyMinimumAmountOut,
      referralTokenAccount: null,
    },
  });
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
  /** Default true for buys: DBC's exact-in `swap` rejects any input larger than what the curve can still
   *  absorb (InsufficientLiquidity near completion); partial fill takes what fits and refunds the rest. */
  partialFill?: boolean;
}

/** `pool.swap` (exact-in). The SDK adds the instructions sysvar itself when the pool's
 *  anti-sniper min-fee flag requires it. */
export async function swapIx(input: DbcSwapInput): Promise<TransactionInstruction[]> {
  const { client, pool, owner, amountIn, minimumAmountOut, swapBaseForQuote } = input;
  const partialFill = input.partialFill ?? !swapBaseForQuote;
  const tx = partialFill
    ? await client.pool.swap2({ pool, owner, swapBaseForQuote, referralTokenAccount: null, swapMode: SwapMode.PartialFill, amountIn, minimumAmountOut })
    : await client.pool.swap({ pool, owner, amountIn, minimumAmountOut, swapBaseForQuote, referralTokenAccount: null });
  return extractIxs(tx);
}

export interface MigrateToDammV2Input {
  client: DynamicBondingCurveClient;
  pool: PublicKey;
  payer: PublicKey;
  /** DAMM v2 config the migrated pool is created under. Defaults to Meteora's config for our
   *  `migrationFeeOption` (Customizable). */
  dammConfig?: PublicKey;
}

/** Meteora's DAMM v2 config for `LAUNCH.migrationFeeOption` (index into the SDK's per-option table). */
export const DAMM_V2_MIGRATION_CONFIG: PublicKey = DAMM_V2_MIGRATION_FEE_ADDRESS[LAUNCH.migrationFeeOption];

export interface MigrateToDammV2Result {
  ixs: TransactionInstruction[];
  /** The two new position-NFT mint keypairs; both must sign the migration transaction. */
  signers: Keypair[];
}

/** `migration.migrateToDammV2`: one tx that migrates and creates the two locked positions. */
export async function migrateToDammV2Ixs(input: MigrateToDammV2Input): Promise<MigrateToDammV2Result> {
  const { client, pool, payer } = input;
  const res = await client.migration.migrateToDammV2({ pool, payer, dammConfig: input.dammConfig ?? DAMM_V2_MIGRATION_CONFIG });
  return { ixs: extractIxs(res.transaction), signers: [res.firstPositionNftKeypair, res.secondPositionNftKeypair] };
}

/**
 * `state.getPool` → the decoded `VirtualPool` fields (`isMigrated`, reserves, `partnerQuoteFee`, ...).
 * SDK 1.5.x returns the account wrapped as `{ poolState: {...} }` (the IDL nests the struct); unwrap so
 * callers (keeper fees/migrate cycles) read the fields directly.
 */
export async function getPoolState(client: DynamicBondingCurveClient, pool: PublicKey) {
  const raw = (await client.state.getPool(pool)) as unknown as { poolState?: Record<string, unknown> } | null;
  if (!raw) return null;
  return (raw.poolState ?? raw) as Record<string, unknown>;
}

/**
 * Every SDK 1.5.x service method used here returns a legacy `Transaction`; flatten it so callers
 * can compose the instructions into their own (versioned, ALT-compiled) transactions.
 */
function extractIxs(tx: unknown): TransactionInstruction[] {
  const ixs = Array.isArray(tx) ? (tx as TransactionInstruction[]) : (tx as { instructions?: TransactionInstruction[] })?.instructions;
  if (!ixs) throw new Error("dbc.ts: unrecognized transaction shape returned by SDK");
  // The SDK prepends its own ComputeBudget instructions; our callers (launch builder, trade builders,
  // keeper sendWithPriority) set their own, and a transaction with two SetComputeUnitLimit ixs is
  // rejected as a duplicate instruction. Strip them here.
  return ixs.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
}
