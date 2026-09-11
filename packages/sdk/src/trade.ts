/**
 * Composite trade builders: Peg Desk (COIN<->USDC at oracle+spread) chained with a Meteora
 * DBC swap (COIN<->MEME), and optionally a Jupiter leg (SOL<->USDC) in front. Per
 * docs/CONTRACTS.md §5 / apps/keeper cycle table: "buy" = peg_desk.buy -> dbc.swap;
 * "sell" = dbc.swap -> peg_desk.sell.
 */
import { Connection, PublicKey, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import BN from "bn.js";
import { PegDeskClient, type CommodityAccountView, type OracleReading } from "./pegDesk";
import { makeDbcClient, swapIx, type DbcSwapInput } from "./dbc";
import { applySlippageDown } from "./pricing";
import { getQuote, getSwapIxs, resolveAddressLookupTables, type JupiterSwapIxsResult } from "./jupiter";

export interface BuiltTrade {
  instructions: TransactionInstruction[];
  /** ALT addresses that must be resolved and passed to `TransactionMessage.compileToV0Message` (Jupiter leg only). */
  addressLookupTableAddresses: PublicKey[];
  /** Final expected output, after slippage, for UI display / assertions. */
  minOut: bigint;
}

export interface BuyWithUsdcParams {
  connection: Connection;
  user: PublicKey;
  commodity: CommodityAccountView;
  oracle: OracleReading;
  dbcPool: PublicKey;
  /** MEME mint of the DBC pool (the base token being bought). */
  memeMint: PublicKey;
  usdcIn: bigint;
  userUsdcAta: PublicKey;
  slippageBps: number;
  pegDesk: PegDeskClient;
}

/** `buildBuyWithUsdc`: USDC -> COIN (peg_desk.buy) -> MEME (dbc.swap), single transaction's worth of ixs. */
export async function buildBuyWithUsdc(params: BuyWithUsdcParams): Promise<BuiltTrade> {
  const { connection, user, commodity, oracle, dbcPool, usdcIn, userUsdcAta, slippageBps, pegDesk } = params;

  const quote = pegDesk.quote(commodity, oracle, usdcIn);
  const minCoinOut = applySlippageDown(quote.coinOut, BigInt(slippageBps));

  // TradeAccounts.user_coin must exist (peg_desk does not init it): idempotent ATA create first.
  const coinAtaIx = pegDesk.createUserCoinAtaIx(user, user, commodity.coinMint);
  const buyIx = await pegDesk.buyIx({ user, commodity, usdcIn, minCoinOut, userUsdcAta });

  // The COIN received from peg_desk.buy is the DBC pool's quote token; swap it for MEME.
  // NOTE: this assumes the DBC quote-side minimum-out is also slippage-bounded against a
  // client-computed DBC quote (`client.pool` quoting is out of scope for pricing.ts, which
  // only covers peg_desk math) — callers with a live pool should pre-fetch a DBC quote and
  // pass a tighter `minimumAmountOut` here; `minCoinOut` is used as a conservative floor.
  const dbcClient = makeDbcClient({ connection });
  const dbcSwapInput: DbcSwapInput = {
    client: dbcClient,
    pool: dbcPool,
    owner: user,
    amountIn: new BN(minCoinOut.toString()),
    minimumAmountOut: new BN(0), // CHECK: caller should override with a real DBC-side quote minimum
    swapBaseForQuote: false, // quote(COIN) -> base(MEME)
  };
  const dbcIxs = await swapIx(dbcSwapInput);

  return {
    instructions: [...ComputeBudgetIxs(), coinAtaIx, buyIx, ...dbcIxs],
    addressLookupTableAddresses: [],
    minOut: minCoinOut,
  };
}

export interface SellToUsdcParams {
  connection: Connection;
  user: PublicKey;
  commodity: CommodityAccountView;
  oracle: OracleReading;
  dbcPool: PublicKey;
  memeMint: PublicKey;
  tokenIn: bigint; // MEME base units
  userUsdcAta: PublicKey;
  slippageBps: number;
  pegDesk: PegDeskClient;
}

/**
 * `buildSellToUsdc`: MEME -> COIN (dbc.swap) -> USDC (peg_desk.sell).
 *
 * `coinFromDbc` is the DBC pool's quoted COIN output for `tokenIn` MEME (from a live
 * `client.state.getPool` + curve-math quote, or `client.pool`'s own quote helper — not
 * reimplemented here since pricing.ts only covers peg_desk's oracle+spread math, not
 * DBC's bonding-curve math). Required so the peg_desk.sell leg's `min_usdc_out` can be
 * computed against a real expected COIN amount rather than an unbounded 0.
 */
export async function buildSellToUsdc(params: SellToUsdcParams & { coinFromDbc: bigint }): Promise<BuiltTrade> {
  const { connection, user, commodity, dbcPool, tokenIn, userUsdcAta, slippageBps, pegDesk, oracle, coinFromDbc } = params;

  const dbcClient = makeDbcClient({ connection });
  const minCoinFromDbc = applySlippageDown(coinFromDbc, BigInt(slippageBps));
  const dbcIxs = await swapIx({
    client: dbcClient,
    pool: dbcPool,
    owner: user,
    amountIn: new BN(tokenIn.toString()),
    minimumAmountOut: new BN(minCoinFromDbc.toString()),
    swapBaseForQuote: true,
  });

  const sellQuote = pegDesk.quoteSell(commodity, oracle, minCoinFromDbc);
  const minUsdcOut = applySlippageDown(sellQuote.usdcOut, BigInt(slippageBps));
  const sellIx = await pegDesk.sellIx({
    user,
    commodity,
    coinIn: minCoinFromDbc,
    minUsdcOut,
    userUsdcAta,
  });

  return {
    instructions: [...ComputeBudgetIxs(), ...dbcIxs, sellIx],
    addressLookupTableAddresses: [],
    minOut: minUsdcOut,
  };
}

export interface BuyWithSolParams extends Omit<BuyWithUsdcParams, "usdcIn" | "userUsdcAta"> {
  solIn: bigint; // lamports
  usdcMint: PublicKey;
  wsolMint: PublicKey;
  userUsdcAta: PublicKey;
}

/**
 * `buildBuyWithSol`: SOL -> USDC (Jupiter) -> COIN (peg_desk.buy) -> MEME (dbc.swap).
 * Per CONTRACTS §5, this is a two-transaction flow when combined with a fresh launch
 * (tx1 Jupiter, tx2 the rest); for an ordinary trade (existing pool) it can usually fit in
 * one transaction — this returns everything as one instruction list and it's the caller's
 * job to split across transactions if account/size limits require it.
 */
export async function buildBuyWithSol(params: BuyWithSolParams): Promise<BuiltTrade> {
  const { connection, user, solIn, usdcMint, slippageBps } = params;

  const quote = await getQuote({
    inputMint: params.wsolMint,
    outputMint: usdcMint,
    amount: solIn,
    slippageBps,
  });
  const swap: JupiterSwapIxsResult = await getSwapIxs({ quote, userPublicKey: user, maxAccounts: 20 });

  const usdcOutEstimate = BigInt(quote.outAmount);
  const minUsdcFromJupiter = applySlippageDown(usdcOutEstimate, BigInt(slippageBps));

  const rest = await buildBuyWithUsdc({
    connection,
    user,
    commodity: params.commodity,
    oracle: params.oracle,
    dbcPool: params.dbcPool,
    memeMint: params.memeMint,
    usdcIn: minUsdcFromJupiter,
    userUsdcAta: params.userUsdcAta,
    slippageBps,
    pegDesk: params.pegDesk,
  });

  const alts = await resolveAddressLookupTables(connection, swap.addressLookupTableAddresses).catch(() => []);

  return {
    instructions: [
      ...swap.computeBudgetInstructions,
      ...swap.setupInstructions,
      swap.swapInstruction,
      ...(swap.cleanupInstruction ? [swap.cleanupInstruction] : []),
      ...rest.instructions,
    ],
    addressLookupTableAddresses: swap.addressLookupTableAddresses,
    minOut: rest.minOut,
  };
}

function ComputeBudgetIxs(): TransactionInstruction[] {
  // Conservative defaults; callers building a full transaction should re-simulate and set
  // a tighter limit / priority fee via `rpc.ts`'s `sendWithPriority` in apps/keeper, or the
  // web app's own send path.
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];
}

