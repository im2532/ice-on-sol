/**
 * `buildLaunchTransactions` — the memecoin launch flow from docs/CONTRACTS.md §5:
 *
 * USDC/COIN path (one tx): [ComputeBudget, peg_desk.buy_exact_out(COIN needed for first
 * buy), dbc.createConfig, dbc.initializeVirtualPoolWithSplToken, dbc.swap(firstBuy),
 * fee_router.register_pool].
 *
 * SOL path (two txs): tx1 = Jupiter SOL->USDC; tx2 = the USDC-path instructions above,
 * fed by tx1's USDC output.
 *
 * v0.2: every transaction is a v0 `VersionedTransaction`. The launch tx touches ~40 accounts (peg_desk
 * trade accounts, DBC config/pool/vaults/metadata, fee_router's 17) and does not fit the 1232-byte limit
 * as a legacy tx; pass `addressLookupTable` (the static-account ALT written by `scripts/create-alt.ts`
 * into `deployments/<cluster>.json`, see `launchAltAddress`) to compress them. The built tx is checked
 * against the size limit and a clear error is thrown if it still does not fit.
 */
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import BN from "bn.js";
import { LAUNCH } from "@icemarkets/registry";
import { feeRouter as feeRouterPda } from "./pda";
import { PegDeskClient, type CommodityAccountView, type OracleReading } from "./pegDesk";
import { FEE_ROUTER_PROGRAM_ID, registerPoolIx } from "./feeRouter";
import { buildLaunchConfigParams, createConfigAndPoolWithFirstBuyIxs, deriveDbcPoolAddress, makeDbcClient } from "./dbc";
import { getQuote, getSwapIxs, resolveAddressLookupTables, type JupiterSwapIxsResult } from "./jupiter";
import { applySlippageDown, applySlippageUp } from "./pricing";

export type PayWith = "USDC" | "COIN" | "SOL";

export interface BuildLaunchTransactionsParams {
  connection: Connection;
  creator: PublicKey;
  /** ICEmarkets registry symbol of the quote commodity, e.g. "GLD". */
  commoditySymbol: string;
  /** New memecoin's name/symbol/metadata URI. */
  name: string;
  symbol: string;
  uri: string;
  feeTierBps: (typeof LAUNCH.feeTiersBps)[number];
  /** First-buy size, in USD. */
  firstBuyUsdc: number;
  payWith: PayWith;

  // Context needed to build/quote the peg_desk leg and DBC config:
  commodity: CommodityAccountView;
  oracle: OracleReading;
  coinUsdPrice: number;
  usdcMint: PublicKey;
  wsolMint: PublicKey;
  userUsdcAta: PublicKey;
  userCoinAta: PublicKey;
  treasury: PublicKey;
  pegDesk: PegDeskClient;
  slippageBps?: number;
  /**
   * Launch address lookup table (static program/commodity accounts; `scripts/create-alt.ts`). Optional,
   * but without it the one-tx launch usually exceeds the 1232-byte packet limit.
   */
  addressLookupTable?: AddressLookupTableAccount | null;
  /** Blockhash to compile against; fetched from `connection` ("confirmed") when omitted. */
  recentBlockhash?: { blockhash: string; lastValidBlockHeight: number };
  /** Resume a launch whose DBC config transaction already landed: skip the config tx and create the
   *  pool under this existing config (no second config rent). */
  existingConfig?: PublicKey;
}

export interface BuildLaunchTransactionsResult {
  /**
   * One v0 tx for USDC/COIN pay-in; two ([jupiterSolToUsdc, launch]) for SOL pay-in. Unsigned: the
   * LAST tx additionally needs `configKeypair` + `baseMintKeypair` (e.g. wallet-adapter
   * `sendTransaction(tx, conn, { signers })`, or `tx.sign([...])` before the wallet signs).
   */
  transactions: VersionedTransaction[];
  /** Extra signers per transaction (parallel to `transactions`): the DBC config keypair on the config
   *  tx, the base mint keypair on the launch tx. Send in order and confirm each before the next. */
  signers: Keypair[][];
  blockhash: string;
  lastValidBlockHeight: number;
  configKeypair: Keypair;
  baseMintKeypair: Keypair;
  /** Exact COIN base units used for the first buy (post buy_exact_out / already-held COIN). */
  coinForFirstBuy: bigint;
  /** USD value of the first buy, echoed back for UI display. */
  firstBuyUsd: number;
}

/**
 * Builds the launch transaction(s). Does not sign or send — caller (web app or a script)
 * adds `configKeypair`/`baseMintKeypair` as additional signers alongside the fee payer.
 */
export async function buildLaunchTransactions(params: BuildLaunchTransactionsParams): Promise<BuildLaunchTransactionsResult> {
  const slippageBps = params.slippageBps ?? 100; // 1% default
  const configKeypair = Keypair.generate();
  const configPubkey = params.existingConfig ?? configKeypair.publicKey;
  const baseMintKeypair = Keypair.generate();

  // 1. Determine how much COIN the first buy needs, in COIN base units.
  const coinDecimals = params.commodity.decimals;
  const coinForFirstBuy = usdToCoinBaseUnits(params.firstBuyUsdc, params.coinUsdPrice, coinDecimals);
  if (coinForFirstBuy < usdToCoinBaseUnits(LAUNCH.minFirstBuyUsd, params.coinUsdPrice, coinDecimals)) {
    throw new Error(`buildLaunchTransactions: firstBuyUsdc must be >= $${LAUNCH.minFirstBuyUsd}`);
  }

  // 2. DBC config params (CONTRACTS §5's exact buildCurveWithTwoSegments block).
  const routerPda = feeRouterPda.router(FEE_ROUTER_PROGRAM_ID)[0];
  const curveConfigParams = buildLaunchConfigParams({
    coinUsdPrice: params.coinUsdPrice,
    feeTierBps: params.feeTierBps,
    routerPda,
    treasury: params.treasury,
    quoteMint: params.commodity.coinMint,
  });

  const dbcClient = makeDbcClient({ connection: params.connection });

  // The DBC createConfig instruction alone carries ~1 KB of curve data, so it cannot share a 1232-byte
  // packet with the pool init + first buy + register_pool; it goes in its own transaction, sent first.
  const restIxsBuilder = async (usdcSourceAta: PublicKey): Promise<{ configIxs: TransactionInstruction[]; launchIxs: TransactionInstruction[] }> => {
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ];

    // peg_desk.buy_exact_out(coin_out=coinForFirstBuy, max_usdc_in=quoted+slippage), skipped
    // when the creator already pays in COIN directly.
    if (params.payWith !== "COIN") {
      // TradeAccounts.user_coin is not init'ed by peg_desk — make sure the creator's COIN ATA exists.
      ixs.push(params.pegDesk.createUserCoinAtaIx(params.creator, params.creator, params.commodity.coinMint));
      const exactOutQuote = params.pegDesk.quoteBuyExactOut(params.commodity, params.oracle, coinForFirstBuy);
      const maxUsdcIn = applySlippageUp(exactOutQuote.maxUsdcIn, BigInt(slippageBps));
      const buyExactOutIx = await params.pegDesk.buyExactOutIx({
        user: params.creator,
        commodity: params.commodity,
        coinOut: coinForFirstBuy,
        maxUsdcIn,
        userUsdcAta: usdcSourceAta,
      });
      ixs.push(buyExactOutIx);
    }

    // dbc.createConfig + initializePool + first buy, built together (the config does not exist on chain
    // yet, so the SDK's fetch-based createPoolWithFirstBuy cannot be used here; CONTRACTS §5).
    const minCoinOutForFirstBuy = applySlippageDown(coinForFirstBuy, 0n); // first buy has no independent slippage input; the DBC min-fee flag protects it
    const { configIxs, poolIxs } = await createConfigAndPoolWithFirstBuyIxs({
      client: dbcClient,
      curveConfigParams,
      config: configPubkey,
      baseMintKeypair,
      quoteMint: params.commodity.coinMint,
      payer: params.creator,
      creator: params.creator,
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      firstBuyQuoteAmount: new BN(coinForFirstBuy.toString()),
      firstBuyMinimumAmountOut: new BN(minCoinOutForFirstBuy.toString()),
    });
    ixs.push(...poolIxs);

    // fee_router.register_pool (permissionless; CONTRACTS §2). Must come after the DBC pool init in
    // the same tx: it validates the pool/config bytes and creates PoolState + holder_vault.
    const dbcPool = deriveDbcPoolAddress(configPubkey, baseMintKeypair.publicKey, params.commodity.coinMint);
    ixs.push(
      registerPoolIx(
        {
          payer: params.creator,
          dbcPool,
          dbcConfig: configPubkey,
          commodity: params.pegDesk.commodityPda(params.commodity.symbol),
          baseMint: baseMintKeypair.publicKey,
          quoteMint: params.commodity.coinMint,
        },
        params.feeTierBps,
        FEE_ROUTER_PROGRAM_ID,
      ),
    );

    return { configIxs, launchIxs: ixs };
  };

  const transactions: VersionedTransaction[] = [];
  const signers: Keypair[][] = [];
  const bh = params.recentBlockhash ?? (await params.connection.getLatestBlockhash("confirmed"));
  const launchAlts = params.addressLookupTable ? [params.addressLookupTable] : [];
  const compile = (instructions: TransactionInstruction[], alts: AddressLookupTableAccount[], what: string): VersionedTransaction => {
    const msg = new TransactionMessage({ payerKey: params.creator, recentBlockhash: bh.blockhash, instructions }).compileToV0Message(alts);
    const tx = new VersionedTransaction(msg);
    assertTxSize(tx, what, alts.length > 0);
    return tx;
  };

  const pushLaunchTxs = ({ configIxs, launchIxs }: { configIxs: TransactionInstruction[]; launchIxs: TransactionInstruction[] }) => {
    if (params.existingConfig) {
      transactions.push(compile(launchIxs, launchAlts, "launch"));
      signers.push([baseMintKeypair]);
      return;
    }
    transactions.push(
      compile(
        [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), ...configIxs],
        launchAlts,
        "launch: DBC config",
      ),
    );
    signers.push([configKeypair]);
    transactions.push(compile(launchIxs, launchAlts, "launch"));
    signers.push([baseMintKeypair]);
  };

  if (params.payWith === "SOL") {
    // tx1: Jupiter SOL -> USDC for the peg_desk buy_exact_out leg.
    const exactOutQuote = params.pegDesk.quoteBuyExactOut(params.commodity, params.oracle, coinForFirstBuy);
    const usdcNeeded = applySlippageUp(exactOutQuote.maxUsdcIn, BigInt(slippageBps));

    // We need to buy at least `usdcNeeded` USDC with SOL; quote SOL->USDC by output amount
    // isn't directly supported by /quote (which is exact-in), so quote a generous SOL
    // amount and rely on the caller re-checking `outAmount >= usdcNeeded` before signing.
    // CHECK: for a tighter UX, iteratively refine solIn or use Jupiter's exact-out mode if
    // the pinned API version supports it.
    const approxSolLamports = estimateSolLamportsForUsdc(usdcNeeded);
    const quote = await getQuote({
      inputMint: params.wsolMint,
      outputMint: params.usdcMint,
      amount: approxSolLamports,
      slippageBps,
    });
    if (BigInt(quote.outAmount) < usdcNeeded) {
      throw new Error(
        `buildLaunchTransactions: SOL->USDC quote (${quote.outAmount}) fell short of the USDC needed (${usdcNeeded}) — retry with a larger SOL estimate`,
      );
    }
    const swap: JupiterSwapIxsResult = await getSwapIxs({ quote, userPublicKey: params.creator, maxAccounts: 20 });

    // Jupiter's computeBudgetInstructions already set the CU limit/price (a second SetComputeUnitLimit
    // would fail the tx with DuplicateInstruction).
    const jupAlts = await resolveAddressLookupTables(params.connection, swap.addressLookupTableAddresses);
    const tx1Ixs = [
      ...(swap.computeBudgetInstructions.length > 0 ? swap.computeBudgetInstructions : [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })]),
      ...swap.setupInstructions,
      swap.swapInstruction,
      ...(swap.cleanupInstruction ? [swap.cleanupInstruction] : []),
    ];
    transactions.push(compile(tx1Ixs, jupAlts, "SOL→USDC swap"));
    signers.push([]);
    pushLaunchTxs(await restIxsBuilder(params.userUsdcAta));
  } else {
    // USDC or COIN pay-in: everything in one transaction.
    const usdcSourceAta = params.payWith === "USDC" ? params.userUsdcAta : params.userCoinAta;
    pushLaunchTxs(await restIxsBuilder(usdcSourceAta));
  }

  return {
    transactions,
    signers,
    blockhash: bh.blockhash,
    lastValidBlockHeight: bh.lastValidBlockHeight,
    configKeypair,
    baseMintKeypair,
    coinForFirstBuy,
    firstBuyUsd: params.firstBuyUsdc,
  };
}

/** Solana packet limit for a serialized transaction (signatures included). */
export const MAX_TX_BYTES = 1232;

function assertTxSize(tx: VersionedTransaction, what: string, hasAlt: boolean): void {
  let size: number;
  try {
    size = tx.serialize().length; // unsigned: signature slots are zero-filled but counted
  } catch (err) {
    throw new Error(`buildLaunchTransactions: ${what} tx does not serialize (${String(err)})${hasAlt ? "" : " — pass addressLookupTable (scripts/create-alt.ts)"}`);
  }
  if (size > MAX_TX_BYTES) {
    throw new Error(
      `buildLaunchTransactions: ${what} tx is ${size} bytes (> ${MAX_TX_BYTES})${hasAlt ? " even with the lookup table — extend it (scripts/create-alt.ts)" : " — pass addressLookupTable (scripts/create-alt.ts)"}`,
    );
  }
}

/** `deployments/<cluster>.json` fields the launch builder reads (written by scripts/seed-commodities.ts + create-alt.ts). */
export interface LaunchDeployment {
  cluster?: string;
  addressLookupTable?: string;
}

/** The launch ALT address from a parsed deployments file, or null. */
export function launchAltAddress(deployment: LaunchDeployment | null | undefined): PublicKey | null {
  const a = deployment?.addressLookupTable;
  if (!a) return null;
  try {
    return new PublicKey(a);
  } catch {
    return null;
  }
}

/** Fetches the launch ALT account (null when the address is null or the table does not exist). */
export async function loadLaunchAlt(connection: Connection, address: PublicKey | null): Promise<AddressLookupTableAccount | null> {
  if (!address) return null;
  const res = await connection.getAddressLookupTable(address);
  return res.value ?? null;
}

function usdToCoinBaseUnits(usd: number, coinUsdPrice: number, coinDecimals: number): bigint {
  if (coinUsdPrice <= 0) throw new Error("usdToCoinBaseUnits: coinUsdPrice must be > 0");
  const coinAmount = usd / coinUsdPrice;
  return BigInt(Math.floor(coinAmount * 10 ** coinDecimals));
}

/** Rough SOL/USDC price heuristic to seed a Jupiter quote request; the actual quote is the source of truth. CHECK: replace with a live SOL/USD oracle read (e.g. Pyth) rather than a hardcoded estimate. */
function estimateSolLamportsForUsdc(usdcBaseUnits6dp: bigint): bigint {
  const ROUGH_SOL_USD = 150; // CHECK: placeholder; fetch a live price instead.
  const usd = Number(usdcBaseUnits6dp) / 1e6;
  const sol = (usd / ROUGH_SOL_USD) * 1.05; // +5% buffer so the quote comfortably covers usdcNeeded
  return BigInt(Math.ceil(sol * 1e9));
}
