/**
 * Pure BigInt port of `programs/peg_desk/src/pricing.rs` (see docs/CONTRACTS.md §1
 * "Pricing"). No I/O, no Solana imports — this file must typecheck standalone and is
 * unit tested in `pricing.test.ts`. The on-chain program is the source of truth; every
 * function here mirrors the Rust function named in its doc comment, with the SAME
 * rounding direction:
 *
 *   rounding always favours the reserve: coin_out / usdc_out round DOWN, usdc_in / ask /
 *   spread components round UP, bid rounds DOWN, reserve ratio rounds DOWN.
 *
 * Where Rust returns `None` (u64 overflow / division by zero) these functions throw
 * `PricingError`, except `effectiveSpreadBps` (which never fails in Rust either) and
 * `reserveRatioBps` (which returns `null` where Rust returns the `u64::MAX` sentinel).
 *
 * Fixed-point conventions (must match constants.rs):
 *  - prices are u64 with PRICE_EXPO = -8, i.e. 1_00000000n == $1.00
 *  - bps are out of 10_000
 *  - amounts are base units at the mint's `decimals` (COIN and USDC both 6 in MVP; the
 *    conversion helpers take decimals as parameters and default to 6/6)
 */

export const PRICE_EXPO = 8;
export const PRICE_SCALE = 10n ** BigInt(PRICE_EXPO); // 1e8
export const BPS_DENOM = 10_000n;
/** constants.rs `MAX_SPREAD_BPS` — hard ceiling on the effective spread. */
export const MAX_SPREAD_BPS = 5_000n;
export const U64_MAX = (1n << 64n) - 1n;
export const COIN_DECIMALS = 6;
export const USDC_DECIMALS = 6;

/** quote_scale values (constants.rs QUOTE_USD / QUOTE_USC / QUOTE_EUR). */
export enum QuoteScale {
  Usd = 0,
  UsCents = 1,
  Eur = 2,
}

/** Mirrors `Status` in peg_desk/src/state.rs (and `Commodity.status` u8). */
export enum Status {
  Open = 0,
  Closed = 1,
  Halted = 2,
}

export class PricingError extends Error {}

/** Per-commodity risk params relevant to pricing (subset of `Commodity` + `GlobalConfig`). */
export interface CommodityPricingParams {
  baseSpreadBps: bigint;
  closedSpreadBps: bigint;
  /** "bps of spread per 1% of conf/price" (registry `confMultBps`). */
  confMultBps: bigint;
  /** Coin mint decimals (6 for every ICEmarkets coin in MVP). */
  coinDecimals: number;
  /** Reserve (quote/USDC) mint decimals. */
  usdcDecimals: number;
  reserveWarnBps: bigint;
  reserveHaltBps: bigint;
}

function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new PricingError(`pow10: bad exponent ${n}`);
  return 10n ** BigInt(n);
}

function toU64(v: bigint, what: string): bigint {
  if (v < 0n || v > U64_MAX) throw new PricingError(`${what}: result does not fit in u64`);
  return v;
}

function ceilDiv(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new PricingError("ceilDiv: division by zero");
  return n / d + (n % d === 0n ? 0n : 1n);
}

/** (numerator, denominator) such that USDC_UNIT / COIN_UNIT == num / den (pricing.rs DEC_NUM / DEC_DEN). */
function decRatio(coinDecimals: number, usdcDecimals: number): [bigint, bigint] {
  return usdcDecimals >= coinDecimals
    ? [pow10(usdcDecimals - coinDecimals), 1n]
    : [1n, pow10(coinDecimals - usdcDecimals)];
}

/**
 * age_penalty (the age term of pricing.rs `effective_spread_bps`): 0 while `age <= maxAge/2`,
 * then linear up to `+baseSpreadBps` at `age >= maxAge`, rounded UP.
 */
export function agePenaltyBps(age: bigint, maxAge: bigint, baseSpreadBps: bigint): bigint {
  const half = maxAge / 2n;
  if (!(age > half && maxAge > half)) return 0n;
  const over = (age < maxAge ? age : maxAge) - half;
  const window = maxAge - half;
  return ceilDiv(baseSpreadBps * over, window);
}

/**
 * conf term of pricing.rs `effective_spread_bps`: `confMultBps` is "bps per 1% of
 * conf/price", i.e. `ceil(conf_mult * conf * 100 / price)`.
 * Example: conf = 0.1% of price, confMult = 50 → +5 bps.
 */
export function confSpreadBps(conf: bigint, price: bigint, confMultBps: bigint): bigint {
  if (price <= 0n) return MAX_SPREAD_BPS;
  return ceilDiv(confMultBps * conf * 100n, price);
}

/** pricing.rs `conf_bps`: conf / price in bps, rounded UP (the ConfidenceTooWide guard input). */
export function confBps(conf: bigint, price: bigint): bigint {
  if (price <= 0n) throw new PricingError("confBps: price must be > 0");
  return toU64(ceilDiv(conf * BPS_DENOM, price), "confBps");
}

/**
 * pricing.rs `effective_spread_bps`:
 * `(status == Closed ? closed : base) + conf_term + age_penalty`, doubled if
 * `reserveRatioBps < warnBps`, clamped to MAX_SPREAD_BPS. Returns MAX_SPREAD_BPS if price == 0.
 * `reserveRatioBps === null` means "no liability" (Rust u64::MAX) → never widens.
 */
export function effectiveSpreadBps(a: {
  base: bigint;
  closed: bigint;
  confMult: bigint;
  conf: bigint;
  price: bigint;
  age: bigint;
  maxAge: bigint;
  status: number;
  reserveRatioBps: bigint | null;
  warnBps: bigint;
}): bigint {
  if (a.price === 0n) return MAX_SPREAD_BPS;
  let s = a.status === Status.Closed ? a.closed : a.base;
  s += confSpreadBps(a.conf, a.price, a.confMult);
  s += agePenaltyBps(a.age, a.maxAge, a.base);
  if (a.reserveRatioBps !== null && a.reserveRatioBps < a.warnBps) s *= 2n;
  return s < MAX_SPREAD_BPS ? s : MAX_SPREAD_BPS;
}

export interface SpreadInputs {
  status: Status;
  conf: bigint;
  price: bigint;
  ageSec: bigint;
  /** Max age for the current status: `max_age_open` if Open, else `max_age_closed` (state.rs `max_age`). */
  maxAgeSec: bigint;
  params: CommodityPricingParams;
  /**
   * PRE-trade reserve ratio (pricing.rs `reserve_ratio_bps(reserve_vault.amount, mint.supply, price)`).
   * When provided it decides the ×2 widening exactly like the program; `null` = no supply.
   */
  reserveRatioBps?: bigint | null;
  /** Legacy override: force the ×2 widening. Ignored when `reserveRatioBps` is provided. */
  reserveWarn?: boolean;
}

/** Effective spread for a quote — `effectiveSpreadBps` fed from `SpreadInputs`. */
export function spreadBps(inputs: SpreadInputs): bigint {
  const { status, conf, price, ageSec, maxAgeSec, params } = inputs;
  let ratio: bigint | null;
  if (inputs.reserveRatioBps !== undefined) ratio = inputs.reserveRatioBps;
  else ratio = inputs.reserveWarn ? 0n : null;
  return effectiveSpreadBps({
    base: params.baseSpreadBps,
    closed: params.closedSpreadBps,
    confMult: params.confMultBps,
    conf,
    price,
    age: ageSec,
    maxAge: maxAgeSec,
    status,
    reserveRatioBps: ratio,
    warnBps: params.reserveWarnBps,
  });
}

/** pricing.rs `ask`: `price * (10_000 + spread) / 10_000`, rounded UP. */
export function askPrice(price: bigint, spread: bigint): bigint {
  return toU64(ceilDiv(price * (BPS_DENOM + spread), BPS_DENOM), "askPrice");
}

/** pricing.rs `bid`: `price * (10_000 - spread) / 10_000`, rounded DOWN; spread ≥ 100% gives 0. */
export function bidPrice(price: bigint, spread: bigint): bigint {
  const keep = BPS_DENOM > spread ? BPS_DENOM - spread : 0n;
  return toU64((price * keep) / BPS_DENOM, "bidPrice");
}

/** pricing.rs `coin_out_for_usdc`: COIN base units for `usdcIn` at `ask`, rounded DOWN. */
export function coinOutForUsdcIn(
  usdcIn: bigint,
  ask: bigint,
  coinDecimals: number = COIN_DECIMALS,
  usdcDecimals: number = USDC_DECIMALS,
): bigint {
  if (ask <= 0n) throw new PricingError("coinOutForUsdcIn: ask must be > 0");
  if (usdcIn < 0n) throw new PricingError("coinOutForUsdcIn: usdcIn must be >= 0");
  const [num, den] = decRatio(coinDecimals, usdcDecimals);
  return toU64((usdcIn * PRICE_SCALE * den) / (ask * num), "coinOutForUsdcIn");
}

/** pricing.rs `usdc_out_for_coin`: USDC base units paid for `coinIn` at `bid`, rounded DOWN. */
export function usdcOutForCoinIn(
  coinIn: bigint,
  bid: bigint,
  coinDecimals: number = COIN_DECIMALS,
  usdcDecimals: number = USDC_DECIMALS,
): bigint {
  if (coinIn < 0n) throw new PricingError("usdcOutForCoinIn: coinIn must be >= 0");
  if (bid < 0n) throw new PricingError("usdcOutForCoinIn: bid must be >= 0");
  const [num, den] = decRatio(coinDecimals, usdcDecimals);
  return toU64((coinIn * bid * num) / (PRICE_SCALE * den), "usdcOutForCoinIn");
}

/**
 * pricing.rs `usdc_in_for_coin`: USDC needed for exactly `coinOut` at `ask`, rounded UP —
 * what `buy_exact_out` charges (pass it, plus slippage, as `max_usdc_in`).
 */
export function maxUsdcInForCoinOut(
  coinOut: bigint,
  ask: bigint,
  coinDecimals: number = COIN_DECIMALS,
  usdcDecimals: number = USDC_DECIMALS,
): bigint {
  // Like Rust, ask == 0 is not rejected here (yields 0); the program never prices at 0.
  if (ask < 0n) throw new PricingError("maxUsdcInForCoinOut: ask must be >= 0");
  if (coinOut < 0n) throw new PricingError("maxUsdcInForCoinOut: coinOut must be >= 0");
  const [num, den] = decRatio(coinDecimals, usdcDecimals);
  return toU64(ceilDiv(coinOut * ask * num, PRICE_SCALE * den), "maxUsdcInForCoinOut");
}

/**
 * pricing.rs `reserve_ratio_bps`: `reserve_usdc / (supply_coin * price)` in bps, rounded DOWN.
 * 10_000 == fully backed. Returns `null` where Rust returns the `u64::MAX` "no liability"
 * sentinel (supply == 0 or price == 0); saturates at U64_MAX like Rust.
 */
export function reserveRatioBps(
  reserveBalance: bigint,
  supply: bigint,
  price: bigint,
  coinDecimals: number = COIN_DECIMALS,
  usdcDecimals: number = USDC_DECIMALS,
): bigint | null {
  if (supply === 0n || price === 0n) return null;
  const [num, den] = decRatio(coinDecimals, usdcDecimals);
  const r = (reserveBalance * BPS_DENOM * PRICE_SCALE * den) / (supply * price * num);
  return r > U64_MAX ? U64_MAX : r;
}

/** pricing.rs `normalize_to_1e8`: re-express `value * 10^expo` at exponent -8, rounded DOWN. */
export function normalizeTo1e8(value: bigint, expo: number): bigint {
  const shift = expo + 8;
  if (!Number.isInteger(shift) || shift < -30 || shift > 30) throw new PricingError(`normalizeTo1e8: bad expo ${expo}`);
  return shift >= 0 ? toU64(value * pow10(shift), "normalizeTo1e8") : value / pow10(-shift);
}

/** pricing.rs `scale_quote`: raw oracle value in the feed's quote unit → USD at 1e8, rounded DOWN. */
export function scaleQuote(rawPrice: bigint, rawExpo: number, quoteScale: number, fxPrice = 0n, fxExpo = 0): bigint {
  const p = normalizeTo1e8(rawPrice, rawExpo);
  switch (quoteScale) {
    case QuoteScale.Usd:
      return p;
    case QuoteScale.UsCents:
      return p / 100n;
    case QuoteScale.Eur: {
      const fx = normalizeTo1e8(fxPrice, fxExpo);
      if (fx === 0n) throw new PricingError("scaleQuote: fx price is zero");
      return toU64((p * fx) / PRICE_SCALE, "scaleQuote");
    }
    default:
      throw new PricingError(`scaleQuote: unknown quote_scale ${quoteScale}`);
  }
}

/** pricing.rs `weighted_sum`: Σ value·weight / 10_000 (weights must sum to 10_000), rounded DOWN. */
export function weightedSum(legs: [bigint, number][]): bigint {
  let wsum = 0n;
  let acc = 0n;
  for (const [v, w] of legs) {
    wsum += BigInt(w);
    acc += v * BigInt(w);
  }
  if (wsum !== BPS_DENOM) throw new PricingError("weightedSum: weights must sum to 10_000");
  return toU64(acc / BPS_DENOM, "weightedSum");
}

export interface QuoteBuyResult {
  spreadBps: bigint;
  ask: bigint;
  coinOut: bigint;
}

export interface QuoteSellResult {
  spreadBps: bigint;
  bid: bigint;
  usdcOut: bigint;
}

export interface QuoteBuyExactOutResult {
  spreadBps: bigint;
  ask: bigint;
  maxUsdcIn: bigint;
}

/** Full client-side buy quote: usdc_in -> (spread, ask, coin_out). Mirrors trade.rs `handle_buy`. */
export function quoteBuy(usdcIn: bigint, spread: SpreadInputs): QuoteBuyResult {
  const s = spreadBps(spread);
  const ask = askPrice(spread.price, s);
  const coinOut = coinOutForUsdcIn(usdcIn, ask, spread.params.coinDecimals, spread.params.usdcDecimals);
  return { spreadBps: s, ask, coinOut };
}

/** Full client-side buy-exact-out quote: coin_out -> (spread, ask, max_usdc_in). Mirrors `handle_buy_exact_out`. */
export function quoteBuyExactOut(coinOut: bigint, spread: SpreadInputs): QuoteBuyExactOutResult {
  const s = spreadBps(spread);
  const ask = askPrice(spread.price, s);
  const maxUsdcIn = maxUsdcInForCoinOut(coinOut, ask, spread.params.coinDecimals, spread.params.usdcDecimals);
  return { spreadBps: s, ask, maxUsdcIn };
}

/** Full client-side sell quote: coin_in -> (spread, bid, usdc_out). Mirrors `handle_sell`. */
export function quoteSell(coinIn: bigint, spread: SpreadInputs): QuoteSellResult {
  const s = spreadBps(spread);
  const bid = bidPrice(spread.price, s);
  const usdcOut = usdcOutForCoinIn(coinIn, bid, spread.params.coinDecimals, spread.params.usdcDecimals);
  return { spreadBps: s, bid, usdcOut };
}

/** Apply a slippage tolerance (bps) to a quoted `coinOut`, rounding down — for `min_coin_out`. */
export function applySlippageDown(amount: bigint, slippageBps: bigint): bigint {
  return (amount * (BPS_DENOM - slippageBps)) / BPS_DENOM;
}

/** Apply a slippage tolerance (bps) to a quoted `usdcOut`/`maxUsdcIn`, rounding up — for `max_usdc_in`. */
export function applySlippageUp(amount: bigint, slippageBps: bigint): bigint {
  const factor = BPS_DENOM + slippageBps;
  return (amount * factor + BPS_DENOM - 1n) / BPS_DENOM;
}
