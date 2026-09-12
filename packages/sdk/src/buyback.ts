/**
 * Buyback v2 client helpers (CONTRACTS §4a): build the swap "route" that `buyback.convert_and_burn`
 * forwards by CPI (USDC → $ICE, signed by the bb_auth PDA), and the instruction itself.
 *
 * Two route sources:
 *   - Jupiter (mainnet/devnet): `/quote` + `/swap-instructions` for `userPublicKey = bb_auth`. The
 *     swap instruction's accounts become `remaining_accounts`, its data becomes `route_data`, and its
 *     lookup tables are needed to compile the v0 transaction.
 *   - DAMM v2 (localnet, or any cluster with an ICE/USDC cp-amm pool): a single cp-amm `swap` with
 *     bb_auth as payer. Same shape, no HTTP.
 * The program only cares that `remaining_accounts` + `route_data` form a valid instruction for the
 * configured `swap_program` and that ICE lands in bb_auth's ICE ATA.
 */
import { AccountMeta, AddressLookupTableAccount, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { DAMM_V2_PROGRAM_ID } from "./meteora";
import { getQuote, getSwapIxs, resolveAddressLookupTables } from "./jupiter";
import { buyback as buybackPda, feeRouter as feeRouterPda } from "./pda";
import type { CommodityAccountView, PegDeskClient } from "./pegDesk";

export const JUPITER_V6_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

export interface BuybackRoute {
  /** Program the route instruction targets (must equal `BuybackState.swap_program`). */
  program: PublicKey;
  /** Route accounts in order; signer flags are recomputed on-chain (only bb_auth signs). */
  keys: AccountMeta[];
  data: Buffer;
  /** Expected ICE out (base units) before slippage, for `min_ice_out`. */
  expectedOut: bigint;
  lookupTables: AddressLookupTableAccount[];
}

/** USDC → ICE via Jupiter, user = bb_auth, destination = bb_auth's ICE ATA. */
export async function buildBuybackRouteViaJupiter(
  connection: Connection,
  p: { usdcMint: PublicKey; iceMint: PublicKey; amountUsdc: bigint; bbAuth: PublicKey; slippageBps: number; maxAccounts?: number },
): Promise<BuybackRoute> {
  const quote = await getQuote({ inputMint: p.usdcMint, outputMint: p.iceMint, amount: p.amountUsdc, slippageBps: p.slippageBps });
  const ixs = await getSwapIxs({ quote, userPublicKey: p.bbAuth, maxAccounts: p.maxAccounts ?? 24 });
  if (ixs.setupInstructions.length > 0) {
    // Setup ixs would need bb_auth to sign as payer (ATA creation). Pre-create bb_auth's ATAs instead.
    throw new Error("Jupiter route needs setup instructions (missing ATA for bb_auth?) — create them first");
  }
  const swap = ixs.swapInstruction;
  if (!swap.programId.equals(JUPITER_V6_PROGRAM_ID)) throw new Error(`unexpected route program ${swap.programId.toBase58()}`);
  return {
    program: swap.programId,
    keys: swap.keys,
    data: Buffer.from(swap.data),
    expectedOut: BigInt(quote.outAmount),
    lookupTables: await resolveAddressLookupTables(connection, ixs.addressLookupTableAddresses),
  };
}

/** USDC → ICE on one DAMM v2 pool (localnet stand-in for Jupiter). */
export async function buildBuybackRouteViaDamm(
  connection: Connection,
  p: { pool: PublicKey; usdcMint: PublicKey; iceMint: PublicKey; amountUsdc: bigint; minOut: bigint; bbAuth: PublicKey; iceTokenProgram?: PublicKey },
): Promise<BuybackRoute> {
  const cpAmm = new CpAmm(connection);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poolState: any = await cpAmm.fetchPoolState(p.pool);
  const tokenAMint = new PublicKey(poolState.tokenAMint);
  const tokenBMint = new PublicKey(poolState.tokenBMint);
  const usdcIsA = tokenAMint.equals(p.usdcMint);
  if (!usdcIsA && !tokenBMint.equals(p.usdcMint)) throw new Error("pool does not contain USDC");
  const iceProg = p.iceTokenProgram ?? TOKEN_PROGRAM_ID;
  const tx = await cpAmm.swap({
    payer: p.bbAuth,
    pool: p.pool,
    inputTokenMint: p.usdcMint,
    outputTokenMint: p.iceMint,
    amountIn: new BN(p.amountUsdc.toString()),
    minimumAmountOut: new BN(p.minOut.toString()),
    tokenAMint,
    tokenBMint,
    tokenAVault: new PublicKey(poolState.tokenAVault),
    tokenBVault: new PublicKey(poolState.tokenBVault),
    tokenAProgram: usdcIsA ? TOKEN_PROGRAM_ID : iceProg,
    tokenBProgram: usdcIsA ? iceProg : TOKEN_PROGRAM_ID,
    referralTokenAccount: null,
    poolState,
  });
  // The SDK may prepend ATA-creation / compute-budget ixs; the route is the cp-amm instruction itself.
  const swap = tx.instructions.find((ix) => ix.programId.equals(DAMM_V2_PROGRAM_ID));
  if (!swap) throw new Error("cp-amm swap instruction not found in SDK transaction");
  return { program: DAMM_V2_PROGRAM_ID, keys: swap.keys, data: Buffer.from(swap.data), expectedOut: p.minOut, lookupTables: [] };
}

/** Accounts + args for `buyback.convert_and_burn` (camelCase of `ConvertAndBurn` in convert_and_burn.rs). */
export async function buildConvertAndBurnIx(p: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buybackProgram: any; // anchor Program for buyback
  pegDesk: PegDeskClient;
  feeRouterProgramId: PublicKey;
  keeper: PublicKey;
  commodity: CommodityAccountView;
  usdcMint: PublicKey;
  iceMint: PublicKey;
  iceTokenProgram?: PublicKey;
  coinAmount: bigint;
  minUsdcOut: bigint;
  minIceOut: bigint;
  route: BuybackRoute;
}): Promise<TransactionInstruction> {
  const bbId: PublicKey = p.buybackProgram.programId;
  const bbAuth = buybackPda.authority(bbId)[0];
  const pegId = p.pegDesk.programId;
  const oracle = p.pegDesk.oracleAccounts(p.commodity);
  const none = pegId; // Anchor: a `None` optional account is passed as the program id
  const iceProg = p.iceTokenProgram ?? TOKEN_PROGRAM_ID;
  const remaining: AccountMeta[] = p.route.keys.map((k) => ({ pubkey: k.pubkey, isWritable: k.isWritable, isSigner: false }));
  return p.buybackProgram.methods
    .convertAndBurn(new BN(p.coinAmount.toString()), new BN(p.minUsdcOut.toString()), new BN(p.minIceOut.toString()), Buffer.from(p.route.data))
    .accountsPartial({
      keeper: p.keeper,
      state: buybackPda.state(bbId)[0],
      bbAuth,
      coinMint: p.commodity.coinMint,
      usdcMint: p.usdcMint,
      iceMint: p.iceMint,
      bbCoin: getAssociatedTokenAddressSync(p.commodity.coinMint, bbAuth, true),
      bbUsdc: getAssociatedTokenAddressSync(p.usdcMint, bbAuth, true),
      bbIce: getAssociatedTokenAddressSync(p.iceMint, bbAuth, true, iceProg),
      feeRouterProgram: p.feeRouterProgramId,
      routerConfig: feeRouterPda.router(p.feeRouterProgramId)[0],
      buybackVault: feeRouterPda.buybackVault(p.feeRouterProgramId, p.commodity.coinMint)[0],
      pegDeskProgram: pegId,
      pegConfig: p.pegDesk.configPda(),
      commodity: p.pegDesk.commodityPda(p.commodity.symbol),
      mintAuth: p.pegDesk.mintAuthPda(),
      reserveVault: p.commodity.reserveVault,
      priceFeed: oracle.priceFeed ?? none,
      fxFeed: oracle.fxFeed ?? none,
      keeperPrice: oracle.keeperPrice ?? none,
      swapProgram: p.route.program,
      tokenProgram: TOKEN_PROGRAM_ID,
      iceTokenProgram: iceProg,
    })
    .remainingAccounts(remaining)
    .instruction();
}
