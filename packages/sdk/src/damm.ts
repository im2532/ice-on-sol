/**
 * Adapter over `@meteora-ag/cp-amm-sdk` (DAMM v2) for exact-in swap quotes, plus a dependency-free read of
 * a DAMM v2 pool's vault reserves. Every uncertain third-party field name lives in THIS FILE ONLY.
 *
 * // CHECK vs SDK @meteora-ag/cp-amm-sdk ^1.1.0 (not installable in this sandbox — no network):
 * //   new CpAmm(connection)
 * //   cpAmm.fetchPoolState(pool) → { tokenAMint, tokenBMint, tokenAVault, tokenBVault, … }
 * //   cpAmm.getQuote({ inAmount: BN, inputTokenMint: PublicKey, slippage: number (percent), poolState,
 * //                    currentTime: number, currentSlot: number, tokenADecimal: number, tokenBDecimal: number })
 * //     → { swapInAmount: BN, consumedInAmount: BN, swapOutAmount: BN, minSwapOutAmount: BN, totalFee: BN, priceImpact: number|Decimal }
 * // Newer SDK minors renamed some of these (e.g. getQuote2 / `amountIn`); fix here only.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CpAmm, getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
import { meteora } from "./meteora";

export interface DammQuote {
  amountIn: bigint;
  /** Expected output after pool fees, before any slippage allowance. */
  amountOut: bigint;
  fee: bigint | null;
  priceImpactPct: number | null;
}

export interface DammQuoteParams {
  connection: Connection;
  pool: PublicKey;
  inputMint: PublicKey;
  amountIn: bigint;
}

const toBig = (v: unknown): bigint => BigInt(String(v));

/** Exact-in quote on a DAMM v2 pool at the current slot/time (fees included). */
export async function quoteDammV2ExactIn(p: DammQuoteParams): Promise<DammQuote> {
  const cpAmm = new CpAmm(p.connection);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poolState: any = await cpAmm.fetchPoolState(p.pool); // CHECK vs SDK
  const tokenAMint = new PublicKey(poolState.tokenAMint);
  const tokenBMint = new PublicKey(poolState.tokenBMint);
  if (!p.inputMint.equals(tokenAMint) && !p.inputMint.equals(tokenBMint)) {
    throw new Error(`quoteDammV2ExactIn: ${p.inputMint.toBase58()} is not a mint of pool ${p.pool.toBase58()}`);
  }
  const [slot, supplyA, supplyB] = await Promise.all([
    p.connection.getSlot("confirmed"),
    p.connection.getTokenSupply(tokenAMint),
    p.connection.getTokenSupply(tokenBMint),
  ]);
  const blockTime = (await p.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = (cpAmm as any).getQuote({
    inAmount: new BN(p.amountIn.toString()),
    inputTokenMint: p.inputMint,
    slippage: 0, // we apply our own bps haircut to swapOutAmount
    poolState,
    currentTime: blockTime,
    currentSlot: slot,
    tokenADecimal: supplyA.value.decimals,
    tokenBDecimal: supplyB.value.decimals,
  }); // CHECK vs SDK
  const out = q?.swapOutAmount ?? q?.outAmount;
  if (out === undefined || out === null) throw new Error("quoteDammV2ExactIn: SDK quote has no swapOutAmount — see CHECK note in damm.ts");
  return {
    amountIn: p.amountIn,
    amountOut: toBig(out),
    fee: q?.totalFee !== undefined ? toBig(q.totalFee) : null,
    priceImpactPct: q?.priceImpact !== undefined ? Number(String(q.priceImpact)) : null,
  };
}

/**
 * Vault balances of a DAMM v2 pool (token vault PDAs `["token_vault", mint, pool]` — CHECK in meteora.ts).
 * Plain RPC reads, no SDK: used for liquidity guards.
 */
export async function dammVaultBalances(connection: Connection, pool: PublicKey, mintA: PublicKey, mintB: PublicKey): Promise<{ a: bigint; b: bigint }> {
  const [a, b] = await Promise.all([
    connection.getTokenAccountBalance(meteora.dammTokenVault(mintA, pool)),
    connection.getTokenAccountBalance(meteora.dammTokenVault(mintB, pool)),
  ]);
  return { a: BigInt(a.value.amount), b: BigInt(b.value.amount) };
}

/** `x × (10_000 − bps) / 10_000`, rounded down. */
export function haircutBps(x: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`haircutBps: bad bps ${bps}`);
  return (x * BigInt(10_000 - bps)) / 10_000n;
}

/**
 * Unclaimed LP fees on a DAMM v2 position (what `claim_position_fee` would pay out right now), in
 * base units of token A / token B. Used by the keeper to skip `claim_damm` when nothing is owed.
 */
export async function dammUnclaimedPositionFees(
  connection: Connection,
  pool: PublicKey,
  position: PublicKey,
): Promise<{ feeTokenA: bigint; feeTokenB: bigint }> {
  const cpAmm = new CpAmm(connection);
  const [poolState, positionState] = await Promise.all([cpAmm.fetchPoolState(pool), cpAmm.fetchPositionState(position)]);
  const r = getUnClaimLpFee(poolState, positionState);
  return { feeTokenA: toBig(r.feeTokenA), feeTokenB: toBig(r.feeTokenB) };
}
