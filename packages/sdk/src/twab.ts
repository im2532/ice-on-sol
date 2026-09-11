/**
 * Time-weighted average balance (TWAB), computed off-chain from `balance_events` rows
 * (see docs/CONTRACTS.md §"Indexer tables": `balance_events(pool, wallet, delta, slot, ts)`).
 * Used by `apps/keeper/src/cycles/payouts.ts` to build epoch shares before `open_epoch`.
 *
 * Pure logic, zero runtime dependencies — typechecks and runs standalone. Wallet keys are
 * plain strings (base58 pubkeys) rather than `@solana/web3.js` `PublicKey` so this file
 * has no external deps; callers convert with `pubkey.toBase58()`.
 */

export interface BalanceEvent {
  pool: string;
  wallet: string;
  /** Signed delta in COIN base units (positive = received/bought, negative = sent/sold). */
  delta: bigint;
  /** Unix seconds. Events for a wallet must be processed in ascending `ts` order. */
  ts: number;
}

export interface TwabOptions {
  /** Inclusive epoch start, unix seconds. */
  start: number;
  /** Exclusive epoch end, unix seconds (a wallet's balance is weighted over [start, end)). */
  end: number;
  /** Addresses to exclude entirely from the result (pool vaults, program PDAs, burn address, …). */
  exclude?: Iterable<string>;
}

/**
 * Computes each wallet's time-weighted average balance over `[start, end)`.
 *
 * Algorithm: for each wallet, walk its balance events in time order, tracking the
 * running balance. Each event carries the *previous* balance forward for the duration
 * it was held within the window (clamped to `[start, end)`), then applies the delta.
 * A wallet that buys mid-epoch is weighted only for the time it actually held the
 * balance — "buy mid-epoch gets partial weight" per the spec.
 *
 * `events` need not be pre-sorted or pre-grouped; this function sorts internally.
 * Returns a `Map<wallet, twabBalance>` where `twabBalance` is the time-weighted average
 * balance in COIN base units, computed as `integral(balance dt) / (end - start)`,
 * rounded down. Wallets with zero events in `[start, end)` and no carried-in balance are
 * omitted from the result (there is nothing to weight); a wallet whose balance was 0
 * throughout is also omitted (nothing to pay).
 */
export function computeTwab(events: Iterable<BalanceEvent>, opts: TwabOptions): Map<string, bigint> {
  const { start, end } = opts;
  if (end <= start) throw new Error(`computeTwab: end (${end}) must be > start (${start})`);
  const excludeSet = opts.exclude ? new Set(opts.exclude) : undefined;

  const byWallet = new Map<string, BalanceEvent[]>();
  for (const ev of events) {
    if (excludeSet?.has(ev.wallet)) continue;
    let arr = byWallet.get(ev.wallet);
    if (!arr) {
      arr = [];
      byWallet.set(ev.wallet, arr);
    }
    arr.push(ev);
  }

  const duration = BigInt(end - start);
  const result = new Map<string, bigint>();

  for (const [wallet, walletEvents] of byWallet) {
    walletEvents.sort((a, b) => a.ts - b.ts);

    // Running balance carried in from before `start` (sum of all deltas with ts < start).
    let balance = 0n;
    let i = 0;
    for (; i < walletEvents.length && walletEvents[i].ts < start; i++) {
      balance += walletEvents[i].delta;
    }

    let weightedSum = 0n; // integral of balance * dt, in (coin base units * seconds)
    let cursor = start;

    for (; i < walletEvents.length && walletEvents[i].ts < end; i++) {
      const ev = walletEvents[i];
      const evTs = Math.max(ev.ts, start); // defensive clamp; loop guard already ensures ev.ts >= start here
      if (evTs > cursor) {
        weightedSum += balance * BigInt(evTs - cursor);
        cursor = evTs;
      }
      balance += ev.delta;
    }

    if (cursor < end) {
      weightedSum += balance * BigInt(end - cursor);
    }

    if (weightedSum > 0n) {
      result.set(wallet, weightedSum / duration);
    }
  }

  return result;
}

/**
 * Converts TWAB balances into pro-rata payout shares of `totalAmount`, applying a minimum
 * USD holding filter (via `priceUsd8` at PRICE_EXPO=-8 scale and `coinDecimals`) before
 * splitting. Wallets below `minHoldingUsd` receive nothing and are excluded from the
 * denominator. Remainder from integer division accumulates to the largest holder (so the
 * sum of shares always equals `totalAmount` exactly, matching `push_payouts` + Merkle
 * remainder bookkeeping in CONTRACTS §3).
 */
export function computeShares(
  twab: Map<string, bigint>,
  totalAmount: bigint,
  opts: { minHoldingUsd: number; priceUsd8: bigint; coinDecimals: number },
): Map<string, bigint> {
  const minHoldingBase = usdToCoinBaseUnits(opts.minHoldingUsd, opts.priceUsd8, opts.coinDecimals);
  const eligible = [...twab.entries()].filter(([, bal]) => bal >= minHoldingBase);
  const twabTotal = eligible.reduce((sum, [, bal]) => sum + bal, 0n);

  const shares = new Map<string, bigint>();
  if (twabTotal === 0n || eligible.length === 0) return shares;

  let distributed = 0n;
  let largestWallet = eligible[0][0];
  let largestBal = -1n;

  for (const [wallet, bal] of eligible) {
    const share = (totalAmount * bal) / twabTotal;
    shares.set(wallet, share);
    distributed += share;
    if (bal > largestBal) {
      largestBal = bal;
      largestWallet = wallet;
    }
  }

  const remainder = totalAmount - distributed;
  if (remainder > 0n) {
    shares.set(largestWallet, (shares.get(largestWallet) ?? 0n) + remainder);
  }

  return shares;
}

function usdToCoinBaseUnits(usd: number, priceUsd8: bigint, coinDecimals: number): bigint {
  if (priceUsd8 <= 0n) throw new Error("usdToCoinBaseUnits: priceUsd8 must be > 0");
  // usd (float, e.g. 5) -> cents-precision bigint to avoid float error, then scale.
  const usdCents = BigInt(Math.round(usd * 100));
  const priceScale = 100_000_000n; // 1e8, PRICE_EXPO
  const coinScale = 10n ** BigInt(coinDecimals);
  // baseUnits = (usdCents / 100) / (priceUsd8 / 1e8) * coinScale
  //           = usdCents * 1e8 * coinScale / (100 * priceUsd8)
  return (usdCents * priceScale * coinScale) / (100n * priceUsd8);
}
