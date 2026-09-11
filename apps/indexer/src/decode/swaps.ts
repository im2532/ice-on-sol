/**
 * Meteora DBC (bonding curve) and DAMM v2 (post-migration) swap decoding for REGISTERED pools, from the
 * net token-balance change of each pool's vaults inside one transaction. Pure — no I/O.
 *
 * Why balances instead of the DBC/DAMM instruction/event layouts: vault deltas are venue-agnostic (a
 * direct swap, a Jupiter route through the pool, or a swap CPI from another program all look the same),
 * and they need no third-party IDL. What they cannot see is multiple swaps against the same pool inside
 * one transaction — those collapse into their net (fine for volume/candles; TWAB uses wallet deltas).
 *
 *   base vault −x, quote vault +y  → BUY  (user paid y COIN, received x memecoin)   side 0
 *   base vault +x, quote vault −y  → SELL (user paid x memecoin, received y COIN)   side 1
 *   DBC only: base vault +, quote vault + → pool init with first buy in the same tx; base = memecoin
 *   received by non-vault owners.
 *   anything else (both −: migration / fee claim; quote-only: fee claim) → not a swap.
 *
 * Amounts are what the user paid / received (DBC `collectFeeMode = quote`: the fee stays in the quote
 * vault until claimed, so `quote` on a buy includes the fee and on a sell is net of it). `price_quote =
 * quote / base` is therefore the effective, fee-inclusive price.
 */
import type { NormalizedTx, TokenDelta } from "./types";

export interface PoolRef {
  dbcPool: string;
  baseMint: string; // memecoin
  quoteMint: string; // COIN
  baseVault: string | null; // DBC
  quoteVault: string | null;
  dammPool: string | null;
  dammBaseVault: string | null;
  dammQuoteVault: string | null;
}

export interface DecodedSwap {
  pool: string; // dbc_pool (trades.pool FK)
  venue: "dbc" | "damm";
  side: 0 | 1;
  base: bigint; // memecoin base units
  quote: bigint; // COIN base units
  trader: string;
}

export interface DecodedBalanceDelta {
  pool: string;
  wallet: string;
  delta: bigint; // memecoin base units
}

function sumFor(deltas: readonly TokenDelta[], tokenAccount: string | null): bigint {
  if (!tokenAccount) return 0n;
  let s = 0n;
  for (const d of deltas) if (d.tokenAccount === tokenAccount) s += d.delta;
  return s;
}

/** Net memecoin change per owner, excluding the pool's own vaults. */
function ownerBaseDeltas(tx: NormalizedTx, pool: PoolRef): Map<string, bigint> {
  const vaults = new Set([pool.baseVault, pool.dammBaseVault].filter((v): v is string => !!v));
  const byOwner = new Map<string, bigint>();
  for (const d of tx.tokenDeltas) {
    if (d.mint !== pool.baseMint || vaults.has(d.tokenAccount) || !d.owner) continue;
    byOwner.set(d.owner, (byOwner.get(d.owner) ?? 0n) + d.delta);
  }
  for (const [k, v] of byOwner) if (v === 0n) byOwner.delete(k);
  return byOwner;
}

/** The wallet whose memecoin moved most in the trade's direction; the fee payer when nothing matches. */
function pickTrader(owners: Map<string, bigint>, side: 0 | 1, feePayer: string): string {
  let best: string | null = null;
  let bestAbs = 0n;
  for (const [owner, d] of owners) {
    if ((side === 0 && d <= 0n) || (side === 1 && d >= 0n)) continue;
    const a = d < 0n ? -d : d;
    if (a > bestAbs) {
      best = owner;
      bestAbs = a;
    }
  }
  return best ?? feePayer;
}

function classify(baseD: bigint, quoteD: bigint): { side: 0 | 1; base: bigint; quote: bigint } | null {
  if (baseD < 0n && quoteD > 0n) return { side: 0, base: -baseD, quote: quoteD };
  if (baseD > 0n && quoteD < 0n) return { side: 1, base: baseD, quote: -quoteD };
  return null;
}

export function decodeSwaps(tx: NormalizedTx, pools: readonly PoolRef[]): DecodedSwap[] {
  if (tx.failed) return [];
  const out: DecodedSwap[] = [];
  for (const pool of pools) {
    const owners = ownerBaseDeltas(tx, pool);

    // DBC curve
    const dbcBase = sumFor(tx.tokenDeltas, pool.baseVault);
    const dbcQuote = sumFor(tx.tokenDeltas, pool.quoteVault);
    let c = classify(dbcBase, dbcQuote);
    if (!c && dbcBase > 0n && dbcQuote > 0n) {
      // initialize_virtual_pool + first buy in one tx: the vault is seeded with the curve supply, so its
      // net delta is positive; the bought amount is what non-vault owners received.
      let received = 0n;
      for (const d of owners.values()) if (d > 0n) received += d;
      if (received > 0n) c = { side: 0, base: received, quote: dbcQuote };
    }
    if (c) out.push({ pool: pool.dbcPool, venue: "dbc", ...c, trader: pickTrader(owners, c.side, tx.feePayer) });

    // DAMM v2 (post-migration; token_a = memecoin, token_b = COIN per CONTRACTS §6)
    if (pool.dammBaseVault && pool.dammQuoteVault) {
      const d = classify(sumFor(tx.tokenDeltas, pool.dammBaseVault), sumFor(tx.tokenDeltas, pool.dammQuoteVault));
      if (d) out.push({ pool: pool.dbcPool, venue: "damm", ...d, trader: pickTrader(owners, d.side, tx.feePayer) });
    }
  }
  return out;
}

/**
 * `balance_events` input: every wallet whose memecoin balance changed in this tx, for every registered
 * pool whose base mint moved (swaps, plain transfers, airdrops, burns …). Pool vaults are excluded; other
 * program-owned holders (pool authorities, router PDAs) are excluded later by the keeper's TWAB filter.
 */
export function decodeBalanceDeltas(tx: NormalizedTx, pools: readonly PoolRef[]): DecodedBalanceDelta[] {
  if (tx.failed) return [];
  const out: DecodedBalanceDelta[] = [];
  for (const pool of pools) {
    for (const [wallet, delta] of ownerBaseDeltas(tx, pool)) out.push({ pool: pool.dbcPool, wallet, delta });
  }
  return out;
}

/** Mints whose balances moved — used to look up candidate pools by `base_mint`. */
export function touchedMints(tx: NormalizedTx): string[] {
  return [...new Set(tx.tokenDeltas.map((d) => d.mint))];
}
