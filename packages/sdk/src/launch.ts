/**
 * `buildLaunchTransactions` — the memecoin launch flow from docs/CONTRACTS.md §5:
 *
 * USDC/COIN path (one tx): [ComputeBudget, peg_desk.buy_exact_out(COIN needed for first
 * buy), dbc.createConfig, dbc.initializeVirtualPoolWithSplToken, dbc.swap(firstBuy),
 * fee_router.register_pool].
 *
 * SOL path (two txs): tx1 = Jupiter SOL->USDC; tx2 = the USDC-path instructions above,
 * fed by tx1's USDC output.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import BN from "bn.js";
import { LAUNCH } from "@icemarkets/registry";
import { feeRouter as feeRouterPda } from "./pda";
import { PegDeskClient, type CommodityAccountView, type OracleReading } from "./pegDesk";
import { FEE_ROUTER_PROGRAM_ID, registerPoolIx } from "./feeRouter";
import { buildLaunchConfigParams, createConfigIx, createPoolWithFirstBuyIxs, deriveDbcPoolAddress, makeDbcClient } from "./dbc";
import { getQuote, getSwapIxs, type JupiterSwapIxsResult } from "./jupiter";
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
}

export interface BuildLaunchTransactionsResult {
  /** One tx for USDC/COIN pay-in; two txs ([jupiterSolToUsdc, rest]) for SOL pay-in. */
  transactions: Transaction[];
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

  const restIxsBuilder = async (usdcSourceAta: PublicKey): Promise<TransactionInstruction[]> => {
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

    // dbc.createConfig
    const createConfig = await createConfigIx({
      client: dbcClient,
      configKeypair,
      payer: params.creator,
      curveConfigParams,
    });
    ixs.push(...createConfig);

    // dbc.initializePool + first buy (createPoolWithFirstBuy per CONTRACTS §5)
    const minCoinOutForFirstBuy = applySlippageDown(coinForFirstBuy, 0n); // first buy has no independent slippage input; the DBC min-fee flag protects it
    const createPoolAndBuy = await createPoolWithFirstBuyIxs({
      client: dbcClient,
      config: configKeypair.publicKey,
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
    ixs.push(...createPoolAndBuy);

    // fee_router.register_pool (permissionless; CONTRACTS §2). Must come after the DBC pool init in
    // the same tx: it validates the pool/config bytes and creates PoolState + holder_vault.
    const dbcPool = deriveDbcPoolAddress(configKeypair.publicKey, baseMintKeypair.publicKey, params.commodity.coinMint);
    ixs.push(
      registerPoolIx(
        {
          payer: params.creator,
          dbcPool,
          dbcConfig: configKeypair.publicKey,
          commodity: params.pegDesk.commodityPda(params.commodity.symbol),
          baseMint: baseMintKeypair.publicKey,
          quoteMint: params.commodity.coinMint,
        },
        params.feeTierBps,
        FEE_ROUTER_PROGRAM_ID,
      ),
    );

    return ixs;
  };

  const transactions: Transaction[] = [];

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

    const tx1 = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ...swap.computeBudgetInstructions,
      ...swap.setupInstructions,
      swap.swapInstruction,
      ...(swap.cleanupInstruction ? [swap.cleanupInstruction] : []),
    );
    transactions.push(tx1);

    const tx2 = new Transaction().add(...(await restIxsBuilder(params.userUsdcAta)));
    transactions.push(tx2);
  } else {
    // USDC or COIN pay-in: everything fits in one transaction.
    const usdcSourceAta = params.payWith === "USDC" ? params.userUsdcAta : params.userCoinAta;
    const tx = new Transaction().add(...(await restIxsBuilder(usdcSourceAta)));
    transactions.push(tx);
  }

  return {
    transactions,
    configKeypair,
    baseMintKeypair,
    coinForFirstBuy,
    firstBuyUsd: params.firstBuyUsdc,
  };
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
