//! Pure pricing math. No Anchor / Solana types so it can be unit-tested (and fuzzed) in isolation.
//!
//! Conventions
//! - prices are u64 at 1e8 (PRICE_EXPO = -8), amounts are token base units, spreads are bps.
//! - every intermediate is u128; every fallible op is checked and returns `None` on overflow
//!   or division by zero. Callers map `None` to `PegDeskError::MathOverflow`.
//! - rounding always favours the reserve: coin_out / usdc_out round DOWN, usdc_in / ask /
//!   spread components round UP, bid rounds DOWN, reserve ratio rounds DOWN.

use crate::constants::{
    BPS, COIN_DECIMALS, MAX_SPREAD_BPS, PRICE_SCALE, QUOTE_EUR, QUOTE_USC, QUOTE_USD,
    STATUS_CLOSED, USDC_DECIMALS,
};

/// USDC_UNIT / COIN_UNIT expressed as (numerator, denominator) so equal decimals cost nothing
/// and never overflow.
const DEC_NUM: u128 = if USDC_DECIMALS >= COIN_DECIMALS {
    10u128.pow((USDC_DECIMALS - COIN_DECIMALS) as u32)
} else {
    1
};
const DEC_DEN: u128 = if USDC_DECIMALS >= COIN_DECIMALS {
    1
} else {
    10u128.pow((COIN_DECIMALS - USDC_DECIMALS) as u32)
};

const P: u128 = PRICE_SCALE as u128;
const B: u128 = BPS as u128;

#[inline]
fn to_u64(v: u128) -> Option<u64> {
    u64::try_from(v).ok()
}

#[inline]
fn ceil_div(n: u128, d: u128) -> Option<u128> {
    if d == 0 {
        return None;
    }
    Some(n / d + if n % d == 0 { 0 } else { 1 })
}

/// Effective spread in bps.
///
/// `spread = (status == Closed ? closed : base) + conf_mult * (conf / price in %) + age_penalty`,
/// doubled if `reserve_ratio_bps < warn_bps`, clamped to `MAX_SPREAD_BPS`.
/// `age_penalty = 0` while `age <= max_age / 2`, then linear up to `+base` at `age >= max_age`.
#[allow(clippy::too_many_arguments)]
pub fn effective_spread_bps(
    base: u16,
    closed: u16,
    conf_mult: u16,
    conf: u64,
    price: u64,
    age: u64,
    max_age: u32,
    status: u8,
    reserve_ratio_bps: u64,
    warn_bps: u16,
) -> u16 {
    if price == 0 {
        return MAX_SPREAD_BPS;
    }
    let mut s: u128 = if status == STATUS_CLOSED {
        closed
    } else {
        base
    } as u128;

    // conf_mult is "bps per 1% of conf/price": term = conf_mult * conf * 100 / price (ceil).
    let conf_term = ceil_div(conf_mult as u128 * conf as u128 * 100, price as u128)
        .unwrap_or(MAX_SPREAD_BPS as u128);
    s = s.saturating_add(conf_term);

    // Age penalty.
    let max_age = max_age as u64;
    let half = max_age / 2;
    if age > half && max_age > half {
        let over = age.min(max_age) - half;
        let window = max_age - half;
        let pen = ceil_div(base as u128 * over as u128, window as u128).unwrap_or(0);
        s = s.saturating_add(pen);
    }

    if reserve_ratio_bps < warn_bps as u64 {
        s = s.saturating_mul(2);
    }

    s.min(MAX_SPREAD_BPS as u128) as u16
}

/// `ask = price * (10_000 + spread) / 10_000`, rounded up.
pub fn ask(price: u64, spread_bps: u16) -> Option<u64> {
    let n = (price as u128).checked_mul(B + spread_bps as u128)?;
    to_u64(ceil_div(n, B)?)
}

/// `bid = price * (10_000 - spread) / 10_000`, rounded down. Spread ≥ 100% gives 0.
pub fn bid(price: u64, spread_bps: u16) -> Option<u64> {
    let keep = B.saturating_sub(spread_bps as u128);
    to_u64((price as u128).checked_mul(keep)? / B)
}

/// COIN base units received for `usdc_in` USDC base units at `ask` (1e8). Rounds down.
pub fn coin_out_for_usdc(usdc_in: u64, ask: u64) -> Option<u64> {
    if ask == 0 {
        return None;
    }
    // coin = usdc_in * COIN_UNIT/USDC_UNIT * 1e8 / ask
    let n = (usdc_in as u128).checked_mul(P)?.checked_mul(DEC_DEN)?;
    let d = (ask as u128).checked_mul(DEC_NUM)?;
    to_u64(n / d)
}

/// USDC base units required to receive exactly `coin_out` at `ask`. Rounds up.
pub fn usdc_in_for_coin(coin_out: u64, ask: u64) -> Option<u64> {
    let n = (coin_out as u128)
        .checked_mul(ask as u128)?
        .checked_mul(DEC_NUM)?;
    let d = P.checked_mul(DEC_DEN)?;
    to_u64(ceil_div(n, d)?)
}

/// USDC base units paid out for `coin_in` at `bid`. Rounds down.
pub fn usdc_out_for_coin(coin_in: u64, bid: u64) -> Option<u64> {
    let n = (coin_in as u128)
        .checked_mul(bid as u128)?
        .checked_mul(DEC_NUM)?;
    let d = P.checked_mul(DEC_DEN)?;
    to_u64(n / d)
}

/// Reserve ratio in bps: `reserve_usdc / (supply_coin * price)`. Rounds down; saturates at
/// `u64::MAX` (and returns `u64::MAX` when there is no liability).
pub fn reserve_ratio_bps(reserve_usdc: u64, supply_coin: u64, price: u64) -> u64 {
    if supply_coin == 0 || price == 0 {
        return u64::MAX;
    }
    // ratio = reserve * BPS * 1e8 * COIN_UNIT / (supply * price * USDC_UNIT)
    let n = (reserve_usdc as u128)
        .checked_mul(B)
        .and_then(|v| v.checked_mul(P))
        .and_then(|v| v.checked_mul(DEC_DEN));
    let d = (supply_coin as u128)
        .checked_mul(price as u128)
        .and_then(|v| v.checked_mul(DEC_NUM));
    match (n, d) {
        (Some(n), Some(d)) => to_u64(n / d).unwrap_or(u64::MAX),
        // Numerator overflow → ratio is astronomically high; denominator overflow cannot happen
        // with equal decimals, treat conservatively as 0.
        (None, Some(_)) => u64::MAX,
        _ => 0,
    }
}

/// `conf / price` in bps, rounded up. `None` if price == 0.
pub fn conf_bps(conf: u64, price: u64) -> Option<u64> {
    to_u64(ceil_div((conf as u128).checked_mul(B)?, price as u128)?)
}

/// Re-express `value * 10^expo` at exponent -8. Rounds down. `None` on overflow or absurd expo.
pub fn normalize_to_1e8(value: u64, expo: i32) -> Option<u64> {
    let shift = expo.checked_add(8)?; // target is 10^-8
    if !(-30..=30).contains(&shift) {
        return None;
    }
    if shift >= 0 {
        to_u64((value as u128).checked_mul(10u128.checked_pow(shift as u32)?)?)
    } else {
        to_u64(value as u128 / 10u128.checked_pow((-shift) as u32)?)
    }
}

/// Convert a raw oracle value (`raw_price * 10^raw_expo`, in the feed's quote unit) to USD at 1e8.
/// quote_scale: 0 = USD, 1 = US cents (÷100), 2 = EUR (× fx, where fx = EUR→USD).
pub fn scale_quote(
    raw_price: u64,
    raw_expo: i32,
    quote_scale: u8,
    fx_price: u64,
    fx_expo: i32,
) -> Option<u64> {
    let p = normalize_to_1e8(raw_price, raw_expo)?;
    match quote_scale {
        QUOTE_USD => Some(p),
        QUOTE_USC => Some(p / 100),
        QUOTE_EUR => {
            let fx = normalize_to_1e8(fx_price, fx_expo)?;
            if fx == 0 {
                return None;
            }
            to_u64((p as u128).checked_mul(fx as u128)? / P)
        }
        _ => None,
    }
}

/// Weighted sum of `(value_1e8, weight_bps)` legs; weights must sum to 10_000. Rounds down.
pub fn weighted_sum(legs: &[(u64, u16)]) -> Option<u64> {
    let mut wsum: u128 = 0;
    let mut acc: u128 = 0;
    for (v, w) in legs {
        wsum += *w as u128;
        acc = acc.checked_add((*v as u128).checked_mul(*w as u128)?)?;
    }
    if wsum != B {
        return None;
    }
    to_u64(acc / B)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{STATUS_HALTED, STATUS_OPEN};

    const USD: u64 = PRICE_SCALE; // $1 at 1e8
    const ONE_USDC: u64 = 1_000_000;
    const ONE_COIN: u64 = 1_000_000;
    const NO_ALERT: u64 = u64::MAX;

    fn spread_simple(base: u16, status: u8) -> u16 {
        effective_spread_bps(
            base,
            150,
            0,
            0,
            2_000 * USD,
            0,
            60,
            status,
            NO_ALERT,
            10_200,
        )
    }

    // ---- spread -----------------------------------------------------------------

    #[test]
    fn base_spread_when_open_and_fresh() {
        assert_eq!(spread_simple(10, STATUS_OPEN), 10);
    }

    #[test]
    fn closed_spread_replaces_base() {
        assert_eq!(spread_simple(10, STATUS_CLOSED), 150);
        // Halted is not "closed" for spread purposes (trades are rejected before pricing anyway).
        assert_eq!(spread_simple(10, STATUS_HALTED), 10);
    }

    #[test]
    fn conf_term_bps_per_percent() {
        // conf = 0.1% of price, conf_mult = 50 bps per 1% → +5 bps.
        let p = 2_000 * USD;
        let conf = p / 1000;
        let s = effective_spread_bps(10, 10, 50, conf, p, 0, 60, STATUS_OPEN, NO_ALERT, 10_200);
        assert_eq!(s, 15);
        // conf term rounds up: tiny conf still costs 1 bp when conf_mult > 0.
        let s = effective_spread_bps(10, 10, 50, 1, p, 0, 60, STATUS_OPEN, NO_ALERT, 10_200);
        assert_eq!(s, 11);
        // conf_mult 0 disables it.
        let s = effective_spread_bps(10, 10, 0, conf, p, 0, 60, STATUS_OPEN, NO_ALERT, 10_200);
        assert_eq!(s, 10);
    }

    #[test]
    fn age_penalty_linear_after_half() {
        let p = 2_000 * USD;
        let f = |age| effective_spread_bps(20, 20, 0, 0, p, age, 60, STATUS_OPEN, NO_ALERT, 0);
        assert_eq!(f(0), 20);
        assert_eq!(f(30), 20); // exactly half: no penalty
        assert_eq!(f(45), 30); // 3/4 → +base/2
        assert_eq!(f(60), 40); // max → +base
        assert_eq!(f(600), 40); // capped at +base
        assert_eq!(f(31), 21); // ceil(20 * 1 / 30) = 1
    }

    #[test]
    fn age_penalty_zero_max_age_is_safe() {
        let s = effective_spread_bps(10, 10, 0, 0, USD, 5, 0, STATUS_OPEN, NO_ALERT, 0);
        assert_eq!(s, 10);
    }

    #[test]
    fn reserve_warn_doubles_spread() {
        let p = 2_000 * USD;
        let s = effective_spread_bps(10, 10, 0, 0, p, 0, 60, STATUS_OPEN, 10_199, 10_200);
        assert_eq!(s, 20);
        let s = effective_spread_bps(10, 10, 0, 0, p, 0, 60, STATUS_OPEN, 10_200, 10_200);
        assert_eq!(s, 10);
    }

    #[test]
    fn spread_is_clamped() {
        let s = effective_spread_bps(
            u16::MAX,
            0,
            u16::MAX,
            u64::MAX,
            1,
            u64::MAX,
            u32::MAX,
            0,
            0,
            u16::MAX,
        );
        assert_eq!(s, MAX_SPREAD_BPS);
        assert_eq!(
            effective_spread_bps(10, 10, 0, 0, 0, 0, 60, 0, NO_ALERT, 0),
            MAX_SPREAD_BPS
        );
    }

    // ---- ask / bid ----------------------------------------------------------------

    #[test]
    fn ask_rounds_up_bid_rounds_down() {
        assert_eq!(ask(2_000 * USD, 10), Some(2_002 * USD));
        assert_eq!(bid(2_000 * USD, 10), Some(1_998 * USD));
        // 3 * 10_001 / 10_000 = 3.0003 → ask 4, bid 2.9997 → 2
        assert_eq!(ask(3, 1), Some(4));
        assert_eq!(bid(3, 1), Some(2));
        assert_eq!(bid(USD, 10_000), Some(0));
        assert_eq!(bid(USD, u16::MAX), Some(0));
        assert_eq!(ask(u64::MAX, u16::MAX), None); // overflow → None, no panic
    }

    // ---- conversions --------------------------------------------------------------

    #[test]
    fn coin_out_rounds_down() {
        // $10 at $3.00 ask → 3.333333 coin
        assert_eq!(coin_out_for_usdc(10 * ONE_USDC, 3 * USD), Some(3_333_333));
        // 1 base unit of USDC at $3 → 0 coin
        assert_eq!(coin_out_for_usdc(1, 3 * USD), Some(0));
        // $2002 at $2002 ask → exactly 1 coin
        assert_eq!(
            coin_out_for_usdc(2_002 * ONE_USDC, 2_002 * USD),
            Some(ONE_COIN)
        );
        assert_eq!(coin_out_for_usdc(ONE_USDC, 0), None);
    }

    #[test]
    fn usdc_in_rounds_up() {
        // 1 base unit of coin at $3.33333333 → 3.33 base units of USDC → 4
        assert_eq!(usdc_in_for_coin(1, 333_333_333), Some(4));
        assert_eq!(
            usdc_in_for_coin(ONE_COIN, 2_002 * USD),
            Some(2_002 * ONE_USDC)
        );
        // exact-out then exact-in never yields fewer coins than requested
        for coin in [1u64, 7, 999_999, 1_234_567, 10 * ONE_COIN] {
            for a in [1u64, 333_333_333, 2_002 * USD, 123_456_789_012] {
                let pay = usdc_in_for_coin(coin, a).unwrap();
                assert!(
                    coin_out_for_usdc(pay, a).unwrap() >= coin,
                    "coin={coin} ask={a}"
                );
            }
        }
    }

    #[test]
    fn usdc_out_rounds_down() {
        assert_eq!(usdc_out_for_coin(3_333_333, 3 * USD), Some(9_999_999));
        assert_eq!(usdc_out_for_coin(1, 99_999_999), Some(0));
    }

    #[test]
    fn round_trip_never_profits() {
        let p = 2_345_678_901_234u64; // $23,456.78901234
        let s = 10;
        let a = ask(p, s).unwrap();
        let b = bid(p, s).unwrap();
        for usdc in [1u64, 17, ONE_USDC, 123 * ONE_USDC + 7, 1_000_000 * ONE_USDC] {
            let coin = coin_out_for_usdc(usdc, a).unwrap();
            let back = usdc_out_for_coin(coin, b).unwrap();
            assert!(back <= usdc, "usdc={usdc} back={back}");
        }
    }

    #[test]
    fn no_overflow_at_extremes() {
        // results that don't fit u64 are None, never a panic
        assert_eq!(coin_out_for_usdc(u64::MAX, 1), None);
        assert_eq!(usdc_in_for_coin(u64::MAX, u64::MAX), None);
        assert_eq!(usdc_out_for_coin(u64::MAX, u64::MAX), None);
        // max supply at a sane price still converts
        let max_supply = u64::MAX / 2;
        assert!(usdc_out_for_coin(max_supply, USD / 1000).is_some());
        assert!(coin_out_for_usdc(u64::MAX, 1_000_000 * USD).is_some());
    }

    // ---- reserve ratio --------------------------------------------------------------

    #[test]
    fn reserve_ratio_basic() {
        // 2002 USDC backing 1 coin at $2000 → 10_010 bps
        assert_eq!(
            reserve_ratio_bps(2_002 * ONE_USDC, ONE_COIN, 2_000 * USD),
            10_010
        );
        assert_eq!(reserve_ratio_bps(0, ONE_COIN, 2_000 * USD), 0);
        assert_eq!(reserve_ratio_bps(1, 0, 2_000 * USD), u64::MAX);
        assert_eq!(reserve_ratio_bps(1, 1, 0), u64::MAX);
        // rounds down: 10_009.99..
        assert_eq!(
            reserve_ratio_bps(2_001_999_999, ONE_COIN, 2_000 * USD),
            10_009
        );
    }

    #[test]
    fn reserve_ratio_no_overflow_at_max_supply() {
        let r = reserve_ratio_bps(u64::MAX, u64::MAX, u64::MAX);
        assert_eq!(r, 0); // 1.8e19 * 1e12 / 3.4e38 → 0, computed without overflow
        let r = reserve_ratio_bps(u64::MAX, u64::MAX, USD);
        assert_eq!(r, 10_000);
        let r = reserve_ratio_bps(u64::MAX, 1, 1);
        assert_eq!(r, u64::MAX); // saturates
    }

    #[test]
    fn conf_bps_rounds_up() {
        assert_eq!(conf_bps(2 * USD, 2_000 * USD), Some(10));
        assert_eq!(conf_bps(1, 2_000 * USD), Some(1));
        assert_eq!(conf_bps(1, 0), None);
    }

    // ---- quote scaling ---------------------------------------------------------------

    #[test]
    fn normalize_exponents() {
        assert_eq!(normalize_to_1e8(123_456, -8), Some(123_456));
        assert_eq!(normalize_to_1e8(123_456, -5), Some(123_456_000));
        assert_eq!(normalize_to_1e8(123_456_789, -10), Some(1_234_567)); // rounds down
        assert_eq!(normalize_to_1e8(5, 2), Some(500 * USD));
        assert_eq!(normalize_to_1e8(u64::MAX, 0), None); // overflow
        assert_eq!(normalize_to_1e8(1, -100), None);
        assert_eq!(normalize_to_1e8(1, i32::MIN), None);
    }

    #[test]
    fn usd_passthrough() {
        // Gold $2,345.67 with Pyth expo -5
        assert_eq!(
            scale_quote(234_567_000, -5, QUOTE_USD, 0, 0),
            Some(234_567_000_000)
        );
    }

    #[test]
    fn cents_scaling() {
        // Wheat 550.25 US cents / bu (expo -2) → $5.5025
        assert_eq!(scale_quote(55_025, -2, QUOTE_USC, 0, 0), Some(550_250_000));
        // Sugar 18.73 c/lb at expo -8 → $0.1873
        assert_eq!(
            scale_quote(1_873_000_000, -8, QUOTE_USC, 0, 0),
            Some(18_730_000)
        );
    }

    #[test]
    fn eur_fx_scaling() {
        // €2,000.00 (expo -2) × 1.08 EUR/USD (expo -8) → $2,160
        assert_eq!(
            scale_quote(200_000, -2, QUOTE_EUR, 108_000_000, -8),
            Some(2_160 * USD)
        );
        // fx with a different exponent: 1.08000 at expo -5
        assert_eq!(
            scale_quote(200_000, -2, QUOTE_EUR, 108_000, -5),
            Some(2_160 * USD)
        );
        // zero fx is rejected
        assert_eq!(scale_quote(200_000, -2, QUOTE_EUR, 0, -8), None);
        // unknown scale
        assert_eq!(scale_quote(1, -8, 9, 0, 0), None);
    }

    #[test]
    fn composite_weighted_sum() {
        // PMX: 40% GLD $2000 / 30% SLV $30 / 15% XPT $1000 / 15% XPD $1000
        let legs = [
            (2_000 * USD, 4_000u16),
            (30 * USD, 3_000),
            (1_000 * USD, 1_500),
            (1_000 * USD, 1_500),
        ];
        assert_eq!(
            weighted_sum(&legs),
            Some(800 * USD + 9 * USD + 150 * USD + 150 * USD)
        );
        assert_eq!(weighted_sum(&[(USD, 5_000)]), None); // weights must sum to 10_000
        assert_eq!(weighted_sum(&[]), None);
    }
}
