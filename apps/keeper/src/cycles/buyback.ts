/**
 * Buyback cycle (CONTRACTS §4, MVP = GLD path only): when fee_router `buyback_vault[GLD]` holds at
 * least the USD threshold, call `buyback.convert_and_burn(amount, min_ice_out, gld_is_token_a)`:
 * pull GLD via fee_router `withdraw_for_buyback` → swap GLD→ICEmarkets on the DAMM v2 ICE/GLD pool → burn.
 *
 * Account keys = camelCase of `ConvertAndBurn` (programs/buyback/src/instructions/convert_and_burn.rs).
 * GLD / ICEmarkets mints and the ICEmarkets pool are read from the on-chain `BuybackState`.
 *
 * Sandwich protection (v0.2): `min_ice_out = quote × (1 − BUYBACK_SLIPPAGE_BPS)`, where `quote` is a
 * cp-amm SDK exact-in quote of GLD→ICE on the ICE/GLD DAMM v2 pool at the current slot (sdk `damm.ts`,
 * CHECK there). If the quote fails the cycle is skipped — it never falls back to an unprotected minimum.
 * The cycle is also skipped while the pool's GLD-side liquidity is < BUYBACK_MIN_LIQUIDITY_MULT × the
 * trade size (default 20×, i.e. the trade moves the GLD reserve by ≤ 5%).
 *
 * Env:
 *   GLD_IS_TOKEN_A              "true" | "false" (default "false") — side of GLD in the ICE/GLD DAMM pool.
 *                               A wrong value makes DAMM reject the vault/mint pairing (cannot misroute funds).
 *   BUYBACK_SLIPPAGE_BPS        haircut on the quote for min_ice_out (default 50 = 0.5%).
 *   BUYBACK_MIN_LIQUIDITY_MULT  skip unless GLD reserve ≥ mult × amount (default 20).
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import {
  DAMM_V2_PROGRAM_ID,
  buyback as buybackPda,
  dammVaultBalances,
  feeRouter as feeRouterPda,
  haircutBps,
  meteora,
  quoteDammV2ExactIn,
} from "@icemarkets/sdk";
import { getConnection, getKeeperKeypair, sendWithPriority } from "../rpc";
import { getProgram, parseEvents, programId } from "../programs";
import { getLatestPrice, recordBuyback } from "../db";
import { childLogger } from "../logger";

const log = childLogger("buyback");

const BUYBACK_THRESHOLD_USD = 50; // small MVP threshold; tune once real volume data exists
const BPS = 10_000n;
const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_MIN_LIQUIDITY_MULT = 20n;

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || v.trim() === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got ${v}`);
  return n;
}

export async function runBuybackCycle(): Promise<void> {
  const connection = getConnection();
  const keeper = getKeeperKeypair();
  const bb = getProgram("buyback");
  const bbId = programId("buyback");
  const frId = programId("fee_router");

  const statePda = buybackPda.state(bbId)[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st: any = await (bb.account as any).buybackState.fetchNullable(statePda);
  if (!st) {
    log.debug("buyback state not initialized; skipping");
    return;
  }
  if (st.paused) return;
  const gldMint: PublicKey = st.gldMint;
  const iceMint: PublicKey = st.iceMint;
  const icePool: PublicKey = st.icePool;

  // buyback_vault[GLD] is a PDA token account itself (authority = router PDA), not an ATA.
  const buybackVault = feeRouterPda.buybackVault(frId, gldMint)[0];
  const balance = await connection.getTokenAccountBalance(buybackVault).catch(() => null);
  if (!balance?.value) return;
  const vaultBaseUnits = BigInt(balance.value.amount);
  // Same cap as the program: min(vault × (1 − reserve_buffer), max_per_cycle).
  let amount = (vaultBaseUnits * (BPS - BigInt(st.reserveBufferBps))) / BPS;
  const maxPerCycle = BigInt(st.maxPerCycle.toString());
  if (maxPerCycle > 0n && amount > maxPerCycle) amount = maxPerCycle;
  if (amount === 0n) return;

  const priceRow = await getLatestPrice("GLD"); // prices.commodity = commodities.symbol
  if (!priceRow) {
    log.warn("no cached GLD price; skipping buyback threshold check this cycle");
    return;
  }
  const amountUsd = (Number(amount) / 1e6) * (Number(priceRow.price) / 1e8);
  if (amountUsd < BUYBACK_THRESHOLD_USD) return;

  const gldIsTokenA = (process.env.GLD_IS_TOKEN_A ?? "false") === "true";
  const bbAuth = buybackPda.authority(bbId)[0];
  const [aMint, bMint] = gldIsTokenA ? [gldMint, iceMint] : [iceMint, gldMint];

  // ---- liquidity guard: GLD reserve must be ≥ mult × trade size -------------------------------------
  const mult = BigInt(envInt("BUYBACK_MIN_LIQUIDITY_MULT", Number(DEFAULT_MIN_LIQUIDITY_MULT)));
  let gldReserve: bigint;
  try {
    const reserves = await dammVaultBalances(connection, icePool, aMint, bMint);
    gldReserve = gldIsTokenA ? reserves.a : reserves.b;
  } catch (err) {
    log.warn({ err: String(err) }, "could not read ICE/GLD pool reserves; skipping buyback this cycle");
    return;
  }
  if (gldReserve < amount * mult) {
    log.warn(
      { gldReserve: gldReserve.toString(), amount: amount.toString(), mult: mult.toString() },
      "ICE/GLD pool too shallow for this buyback (reserve < mult × size); skipping",
    );
    return;
  }

  // ---- quote → min_ice_out ----------------------------------------------------------------------
  const slippageBps = envInt("BUYBACK_SLIPPAGE_BPS", DEFAULT_SLIPPAGE_BPS);
  let minIceMarketsOut: bigint;
  try {
    const quote = await quoteDammV2ExactIn({ connection, pool: icePool, inputMint: gldMint, amountIn: amount });
    minIceMarketsOut = haircutBps(quote.amountOut, slippageBps);
    log.info({ quoteOut: quote.amountOut.toString(), minOut: minIceMarketsOut.toString(), priceImpactPct: quote.priceImpactPct }, "ICE/GLD quote");
  } catch (err) {
    log.warn({ err: String(err) }, "ICE/GLD quote failed; skipping buyback (never send an unprotected min_ice_out)");
    return;
  }
  if (minIceMarketsOut === 0n) {
    log.warn({ amount: amount.toString() }, "quote rounds to 0 ICE; skipping");
    return;
  }

  log.info({ amountUsd, amount: amount.toString() }, "triggering convert_and_burn");
  try {
    const ix: TransactionInstruction = await bb.methods
      .convertAndBurn(new BN(amount.toString()), new BN(minIceMarketsOut.toString()), gldIsTokenA)
      .accountsPartial({
        keeper: keeper.publicKey,
        state: statePda,
        bbAuth,
        feeRouterProgram: frId,
        routerConfig: feeRouterPda.router(frId)[0],
        buybackVault,
        gldMint,
        iceMint,
        bbGld: getAssociatedTokenAddressSync(gldMint, bbAuth, true),
        bbIceMarkets: getAssociatedTokenAddressSync(iceMint, bbAuth, true),
        dammPoolAuthority: meteora.dammPoolAuthority(),
        dammPool: icePool,
        dammTokenAVault: meteora.dammTokenVault(aMint, icePool),
        dammTokenBVault: meteora.dammTokenVault(bMint, icePool),
        dammEventAuthority: meteora.dammEventAuthority(),
        dammProgram: DAMM_V2_PROGRAM_ID,
        gldTokenProgram: TOKEN_PROGRAM_ID,
        iceTokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const sig = await sendWithPriority([ix]);
    const ev = (await parseEvents("buyback", sig).catch(() => [])).find((e) => e.name === "buyback" || e.name === "Buyback");
    await recordBuyback({
      coin_mint: gldMint.toBase58(),
      coin_amount: String(ev?.data.coinAmount ?? amount),
      gld_amount: String(ev?.data.gldAmount ?? amount),
      ice_burned: String(ev?.data.iceBurned ?? "0"),
      sig,
    });
  } catch (err) {
    log.error({ err: String(err) }, "convert_and_burn failed");
  }
}
