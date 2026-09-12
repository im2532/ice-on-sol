/**
 * Buyback cycle v2 (CONTRACTS §4a): for every commodity coin with a fee_router buyback vault worth
 * ≥ BUYBACK_MIN_USD, call `buyback.convert_and_burn(coin_amount, min_usdc_out, min_ice_out, route)`:
 * fee_router `withdraw_for_buyback` → peg_desk `sell` (COIN → USDC) → forwarded swap route
 * (USDC → $ICE) → burn, all in one instruction signed by the bb_auth PDA.
 *
 * Route source (BUYBACK_ROUTE):
 *   jupiter (default)  Jupiter `/quote` + `/swap-instructions` for user = bb_auth (mainnet, devnet).
 *   damm               one cp-amm swap on BUYBACK_DAMM_POOL (localnet: an ICE/USDC DAMM v2 pool).
 *
 * Protection: `min_usdc_out` = Peg Desk bid × (1 − BUYBACK_SLIPPAGE_BPS); `min_ice_out` = route quote ×
 * (1 − BUYBACK_SLIPPAGE_BPS); the program additionally enforces its anchored ICE-per-USDC rate. A failed
 * quote skips the coin — never an unprotected minimum. Coins with a Composite oracle are skipped
 * (peg_desk needs leg accounts the CPI does not carry).
 *
 * Env: BUYBACK_ROUTE, BUYBACK_DAMM_POOL, BUYBACK_MIN_USD (default 50), BUYBACK_SLIPPAGE_BPS (default 50),
 *      BUYBACK_MAX_ACCOUNTS (Jupiter, default 24), BUYBACK_ONLY (comma-separated symbols).
 */
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ORACLE_KIND,
  bidPrice,
  buildBuybackRouteViaDamm,
  buildBuybackRouteViaJupiter,
  buildConvertAndBurnIx,
  buyback as buybackPda,
  feeRouter as feeRouterPda,
  haircutBps,
  usdcOutForCoinIn,
  type BuybackRoute,
} from "@icemarkets/sdk";
import { getConnection, getKeeperKeypair, sendV0WithPriority, sendWithPriority } from "../rpc";
import { getPegDeskClient, getProgram, parseEvents, programId } from "../programs";
import { getLatestPrice, listAllPools, recordBuyback } from "../db";
import { childLogger } from "../logger";

const log = childLogger("buyback");
const BPS = 10_000n;

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
  const pegDesk = getPegDeskClient();

  const statePda = buybackPda.state(bbId)[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st: any = await (bb.account as any).buybackState.fetchNullable(statePda);
  if (!st) {
    log.debug("buyback state not initialized; skipping");
    return;
  }
  if (st.paused) return log.debug("buyback paused; skipping");
  const iceMint: PublicKey = st.iceMint;
  const usdcMint: PublicKey = st.usdcMint;
  const bbAuth = buybackPda.authority(bbId)[0];
  const minIntervalSecs = Number(st.minIntervalSecs);
  const lastCycleTs = Number(st.lastCycleTs.toString());
  const now = Math.floor(Date.now() / 1000);
  if (now - lastCycleTs < minIntervalSecs) return log.debug({ sinceLast: now - lastCycleTs, minIntervalSecs }, "buyback: within min interval; skipping");

  const thresholdUsd = envInt("BUYBACK_MIN_USD", 50);
  const slippageBps = envInt("BUYBACK_SLIPPAGE_BPS", 50);
  const only = process.env.BUYBACK_ONLY ? new Set(process.env.BUYBACK_ONLY.split(",").map((s) => s.trim())) : null;
  const maxPerCycleUsdc = BigInt(st.maxPerCycleUsdc.toString());

  // One coin per cycle (min_interval_secs applies across coins): pick the most valuable vault.
  const pools = await listAllPools();
  const symbols = [...new Set(pools.map((p) => p.commodity))].filter((s) => !only || only.has(s));
  let best: { symbol: string; vault: bigint; usd: number } | null = null;
  const views = new Map<string, Awaited<ReturnType<typeof pegDesk.fetchCommodityView>>>();
  for (const symbol of symbols) {
    try {
      const view = await pegDesk.fetchCommodityView(symbol);
      if (view.oracleKind === ORACLE_KIND.Composite) continue;
      views.set(symbol, view);
      const vault = feeRouterPda.buybackVault(frId, view.coinMint)[0];
      const bal = await connection.getTokenAccountBalance(vault).catch(() => null);
      if (!bal?.value) {
        log.debug({ symbol, vault: vault.toBase58() }, "buyback: no vault account");
        continue;
      }
      const amount = BigInt(bal.value.amount);
      const price = await getLatestPrice(symbol);
      if (!price) {
        log.debug({ symbol }, "buyback: no db price");
        continue;
      }
      const usd = (Number(amount) / 1e6) * (Number(price.price) / 1e8);
      log.debug({ symbol, vaultCoin: amount.toString(), usd, thresholdUsd }, "buyback: vault evaluated");
      if (usd >= thresholdUsd && (!best || usd > best.usd)) best = { symbol, vault: amount, usd };
    } catch (err) {
      log.warn({ symbol, err: String(err) }, "buyback: could not evaluate vault");
    }
  }
  if (!best) return log.debug({ symbols: symbols.length }, "buyback: no vault above threshold");
  const view = views.get(best.symbol)!;

  // Size: vault × (1 − buffer), then cap by max_per_cycle_usdc at the Peg Desk bid.
  let coinAmount = (best.vault * (BPS - BigInt(st.reserveBufferBps))) / BPS;
  const reading = await pegDesk.fetchOracleReading(view);
  const bid = bidPrice(reading.price, view.baseSpreadBps);
  if (maxPerCycleUsdc > 0n) {
    const maxCoin = (maxPerCycleUsdc * 100_000_000n) / bid;
    if (coinAmount > maxCoin) coinAmount = maxCoin;
  }
  if (coinAmount === 0n) return log.debug({ symbol: best.symbol, reserveBufferBps: st.reserveBufferBps }, "buyback: sized to zero; skipping");
  const usdcExpected = usdcOutForCoinIn(coinAmount, bid);
  const minUsdcOut = haircutBps(usdcExpected, slippageBps);
  if (minUsdcOut === 0n) return log.debug({ symbol: best.symbol }, "buyback: min usdc out is zero; skipping");

  // Route USDC → ICE.
  let route: BuybackRoute;
  try {
    const mode = process.env.BUYBACK_ROUTE ?? "jupiter";
    if (mode === "damm") {
      const pool = new PublicKey(process.env.BUYBACK_DAMM_POOL ?? "");
      route = await buildBuybackRouteViaDamm(connection, { pool, usdcMint, iceMint, amountUsdc: minUsdcOut, minOut: 1n, bbAuth });
    } else {
      route = await buildBuybackRouteViaJupiter(connection, {
        usdcMint,
        iceMint,
        amountUsdc: minUsdcOut,
        bbAuth,
        slippageBps,
        maxAccounts: envInt("BUYBACK_MAX_ACCOUNTS", 24),
      });
    }
  } catch (err) {
    log.warn({ symbol: best.symbol, err: String(err) }, "buyback route failed; skipping (never send an unprotected route)");
    return;
  }
  if (!route.program.equals(st.swapProgram)) {
    log.error({ route: route.program.toBase58(), configured: st.swapProgram.toBase58() }, "route program ≠ BuybackState.swap_program");
    return;
  }
  const minIceOut = haircutBps(route.expectedOut, slippageBps);
  if (minIceOut === 0n) return log.debug({ symbol: best.symbol, expectedOut: route.expectedOut.toString(), minUsdcOut: minUsdcOut.toString() }, "buyback: route quotes zero ICE out; skipping");

  // Work ATAs for bb_auth (idempotent; keeper pays rent).
  const ataIxs = [
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, getAssociatedTokenAddressSync(view.coinMint, bbAuth, true), bbAuth, view.coinMint),
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, getAssociatedTokenAddressSync(usdcMint, bbAuth, true), bbAuth, usdcMint),
  ];
  try {
    await sendWithPriority(ataIxs, { cuLimit: 60_000 });
  } catch (err) {
    log.warn({ err: String(err) }, "buyback: ATA prep failed; skipping");
    return;
  }

  log.info(
    { symbol: best.symbol, coinAmount: coinAmount.toString(), usd: best.usd, minUsdcOut: minUsdcOut.toString(), minIceOut: minIceOut.toString() },
    "triggering convert_and_burn",
  );
  try {
    const ix = await buildConvertAndBurnIx({
      buybackProgram: bb,
      pegDesk,
      feeRouterProgramId: frId,
      keeper: keeper.publicKey,
      commodity: view,
      usdcMint,
      iceMint,
      coinAmount,
      minUsdcOut,
      minIceOut,
      route,
    });
    const sig = await sendV0WithPriority([ix], route.lookupTables, { cuLimit: 600_000 });
    const ev = (await parseEvents("buyback", sig).catch(() => [])).find((e) => e.name === "buyback" || e.name === "Buyback");
    await recordBuyback({
      coin_mint: view.coinMint.toBase58(),
      coin_amount: String(ev?.data.coinAmount ?? coinAmount),
      gld_amount: String(ev?.data.usdcOut ?? "0"), // column reused for USDC out (v2)
      ice_burned: String(ev?.data.iceBurned ?? "0"),
      sig,
    });
    log.info({ symbol: best.symbol, sig, iceBurned: String(ev?.data.iceBurned ?? "?") }, "buyback done");
  } catch (err) {
    log.error({ symbol: best.symbol, err: String(err) }, "convert_and_burn failed");
  }
}
