/**
 * Buyback cycle (CONTRACTS §4, MVP = GLD path only): when fee_router `buyback_vault[GLD]` holds at
 * least the USD threshold, call `buyback.convert_and_burn(amount, min_ice_out, gld_is_token_a)`:
 * pull GLD via fee_router `withdraw_for_buyback` → swap GLD→ICEmarkets on the DAMM v2 ICE/GLD pool → burn.
 *
 * Account keys = camelCase of `ConvertAndBurn` (programs/buyback/src/instructions/convert_and_burn.rs).
 * GLD / ICEmarkets mints and the ICEmarkets pool are read from the on-chain `BuybackState`.
 *
 * Env:
 *   GLD_IS_TOKEN_A      "true" | "false" (default "false") — side of GLD in the ICE/GLD DAMM pool.
 *                       A wrong value makes DAMM reject the vault/mint pairing (cannot misroute funds).
 *   BUYBACK_MIN_ICE_OUT  min ICEmarkets base units out per call (default 1). CHECK: replace with a quote
 *                       from the pool reserves (or send via Jito) before mainnet — 1 is sandwichable.
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { DAMM_V2_PROGRAM_ID, buyback as buybackPda, feeRouter as feeRouterPda, meteora } from "@icemarkets/sdk";
import { getConnection, getKeeperKeypair, sendWithPriority } from "../rpc";
import { getProgram, parseEvents, programId } from "../programs";
import { getLatestPrice, recordBuyback } from "../db";
import { childLogger } from "../logger";

const log = childLogger("buyback");

const BUYBACK_THRESHOLD_USD = 50; // small MVP threshold; tune once real volume data exists
const BPS = 10_000n;

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
  const minIceMarketsOut = BigInt(process.env.BUYBACK_MIN_ICE_OUT ?? "1");
  const bbAuth = buybackPda.authority(bbId)[0];
  const [aMint, bMint] = gldIsTokenA ? [gldMint, iceMint] : [iceMint, gldMint];

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
    });
  } catch (err) {
    log.error({ err: String(err) }, "convert_and_burn failed");
  }
}
