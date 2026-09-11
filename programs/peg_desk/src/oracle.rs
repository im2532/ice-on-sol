//! Oracle adapters. Every path returns `OraclePrice { price, conf, publish_time }` in USD at 1e8,
//! already checked for staleness against the commodity's status-dependent max age.
//!
//! All accounts are read from raw `AccountInfo`s with explicit owner + discriminator checks, so
//! the `#[derive(Accounts)]` structs stay simple and no lifetime juggling is needed for
//! `remaining_accounts`.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};

use crate::constants::*;
use crate::errors::PegDeskError;
use crate::pricing;
use crate::state::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OraclePrice {
    /// USD at 1e8.
    pub price: u64,
    /// USD at 1e8.
    pub conf: u64,
    pub publish_time: i64,
}

/// Oracle-related accounts supplied to a trade. Unused slots are `None`.
pub struct OracleAccounts<'a, 'info> {
    /// PythPull: `PriceUpdateV2` (must equal `commodity.feed_account`).
    /// Switchboard (stand-in): `KeeperPrice`-shaped account (must equal `commodity.feed_account`).
    pub price_feed: Option<&'a AccountInfo<'info>>,
    /// PythPull with `quote_scale == EUR`: EUR/USD `PriceUpdateV2` (must equal `fx_feed_account`).
    pub fx_feed: Option<&'a AccountInfo<'info>>,
    /// KeeperSigned: the `KeeperPrice` PDA of this commodity.
    pub keeper_price: Option<&'a AccountInfo<'info>>,
    /// Composite: `[leg_0 Commodity, leg_0 price source, leg_1 Commodity, leg_1 source, …]`
    /// in the same order as `commodity.legs`.
    pub remaining: &'a [AccountInfo<'info>],
}

/// Seconds since `publish_time` (0 if the timestamp is in the future).
pub fn age_secs(clock: &Clock, publish_time: i64) -> u64 {
    clock.unix_timestamp.saturating_sub(publish_time).max(0) as u64
}

/// Read and validate the price for `commodity`, dispatching on its `OracleKind`.
pub fn read_price(
    commodity: &Commodity,
    commodity_key: &Pubkey,
    accts: &OracleAccounts,
    clock: &Clock,
) -> Result<OraclePrice> {
    let kind = commodity
        .oracle_kind_enum()
        .ok_or_else(|| error!(PegDeskError::InvalidOracleKind))?;
    let max_age = commodity.max_age();

    let out = match kind {
        OracleKind::PythPull => {
            let feed = accts
                .price_feed
                .ok_or_else(|| error!(PegDeskError::InvalidFeed))?;
            read_pyth_commodity(commodity, feed, accts.fx_feed, max_age, clock)?
        }
        OracleKind::KeeperSigned => {
            let kp = accts
                .keeper_price
                .ok_or_else(|| error!(PegDeskError::InvalidFeed))?;
            read_keeper_price(kp, commodity_key)?
        }
        OracleKind::Switchboard => {
            let feed = accts
                .price_feed
                .ok_or_else(|| error!(PegDeskError::InvalidFeed))?;
            read_switchboard(commodity, commodity_key, feed)?
        }
        OracleKind::Composite => read_composite(commodity, commodity_key, accts.remaining, clock)?,
    };

    // Uniform staleness gate (Pyth is also checked inside the SDK call).
    require!(
        age_secs(clock, out.publish_time) <= max_age as u64,
        PegDeskError::StaleOracle
    );
    require!(out.price > 0, PegDeskError::NonPositivePrice);
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Pyth pull (PriceUpdateV2)
// ---------------------------------------------------------------------------------------------

struct RawPrice {
    price: u64,
    conf: u64,
    expo: i32,
    publish_time: i64,
}

fn read_pyth_raw(
    info: &AccountInfo,
    expected_key: &Pubkey,
    feed_id: &[u8; 32],
    max_age: u32,
    min_signatures: u8,
    clock: &Clock,
) -> Result<RawPrice> {
    require_keys_eq!(*info.key, *expected_key, PegDeskError::InvalidFeed);
    require_keys_eq!(
        *info.owner,
        pyth_solana_receiver_sdk::ID,
        PegDeskError::InvalidFeed
    );

    let data = info.try_borrow_data()?;
    let update = PriceUpdateV2::try_deserialize(&mut &data[..])
        .map_err(|_| error!(PegDeskError::InvalidFeed))?;

    // Explicit checks first so failures get a precise error; the SDK call below then only fails
    // on staleness.
    require!(
        update.price_message.feed_id == *feed_id,
        PegDeskError::InvalidFeed
    );
    let level_ok = match &update.verification_level {
        VerificationLevel::Full => true,
        VerificationLevel::Partial { num_signatures } => {
            min_signatures > 0 && *num_signatures >= min_signatures
        }
    };
    require!(level_ok, PegDeskError::InvalidFeed);

    let p = if min_signatures == 0 {
        // Tier A: require a fully verified update.
        update
            .get_price_no_older_than(clock, max_age as u64, feed_id)
            .map_err(|_| error!(PegDeskError::StaleOracle))?
    } else {
        update
            .get_price_no_older_than_with_custom_verification_level(
                clock,
                max_age as u64,
                feed_id,
                VerificationLevel::Partial {
                    num_signatures: min_signatures,
                },
            )
            .map_err(|_| error!(PegDeskError::StaleOracle))?
    };

    require!(p.price > 0, PegDeskError::NonPositivePrice);
    Ok(RawPrice {
        price: p.price as u64,
        conf: p.conf,
        expo: p.exponent,
        publish_time: p.publish_time,
    })
}

fn read_pyth_commodity(
    c: &Commodity,
    feed: &AccountInfo,
    fx_feed: Option<&AccountInfo>,
    max_age: u32,
    clock: &Clock,
) -> Result<OraclePrice> {
    let raw = read_pyth_raw(
        feed,
        &c.feed_account,
        &c.feed_id,
        max_age,
        c.pyth_min_signatures,
        clock,
    )?;

    if c.quote_scale != QUOTE_EUR {
        let price = pricing::scale_quote(raw.price, raw.expo, c.quote_scale, 0, 0)
            .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
        let conf = pricing::scale_quote(raw.conf, raw.expo, c.quote_scale, 0, 0)
            .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
        return Ok(OraclePrice {
            price,
            conf,
            publish_time: raw.publish_time,
        });
    }

    // EUR-quoted: multiply by EUR/USD.
    let fx_info = fx_feed.ok_or_else(|| error!(PegDeskError::InvalidFeed))?;
    let fx = read_pyth_raw(
        fx_info,
        &c.fx_feed_account,
        &c.fx_feed_id,
        max_age,
        c.pyth_min_signatures,
        clock,
    )?;
    let price = pricing::scale_quote(raw.price, raw.expo, QUOTE_EUR, fx.price, fx.expo)
        .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    // conf_usd ≈ conf_eur·fx + price_eur·conf_fx
    let conf_a = pricing::scale_quote(raw.conf, raw.expo, QUOTE_EUR, fx.price, fx.expo)
        .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    let conf_b =
        pricing::scale_quote(raw.price, raw.expo, QUOTE_EUR, fx.conf, fx.expo).unwrap_or(0);
    let conf = conf_a
        .checked_add(conf_b)
        .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    Ok(OraclePrice {
        price,
        conf,
        // Staleness / monotonic guard follow the older of the two updates.
        publish_time: raw.publish_time.min(fx.publish_time),
    })
}

// ---------------------------------------------------------------------------------------------
// KeeperSigned
// ---------------------------------------------------------------------------------------------

fn load_keeper_price(info: &AccountInfo, commodity_key: &Pubkey) -> Result<KeeperPrice> {
    require_keys_eq!(*info.owner, crate::ID, PegDeskError::InvalidFeed);
    let data = info.try_borrow_data()?;
    let kp = KeeperPrice::try_deserialize(&mut &data[..])
        .map_err(|_| error!(PegDeskError::InvalidFeed))?;
    // A KeeperPrice owned by this program can only have been created at PDA ["kp", commodity]
    // (see keeper_update_price), so matching the stored commodity is sufficient.
    require_keys_eq!(kp.commodity, *commodity_key, PegDeskError::InvalidFeed);
    Ok(kp)
}

fn read_keeper_price(info: &AccountInfo, commodity_key: &Pubkey) -> Result<OraclePrice> {
    let kp = load_keeper_price(info, commodity_key)?;
    Ok(OraclePrice {
        price: kp.price,
        conf: kp.conf,
        publish_time: kp.publish_time,
    })
}

// ---------------------------------------------------------------------------------------------
// Switchboard (stand-in)
// ---------------------------------------------------------------------------------------------

/// TODO(switchboard): replace with `switchboard-on-demand` `PullFeedAccountData::parse` +
/// `get_value(&clock, max_stale_slots, min_samples, only_positive)` once that crate is added to
/// the workspace. Until then a Switchboard commodity reads a `KeeperPrice`-shaped account at
/// `commodity.feed_account` (the keeper relays the Switchboard value via `keeper_update_price`).
fn read_switchboard(
    c: &Commodity,
    commodity_key: &Pubkey,
    feed: &AccountInfo,
) -> Result<OraclePrice> {
    require_keys_eq!(*feed.key, c.feed_account, PegDeskError::InvalidFeed);
    read_keeper_price(feed, commodity_key)
}

// ---------------------------------------------------------------------------------------------
// Composite (index coins)
// ---------------------------------------------------------------------------------------------

pub fn load_commodity(info: &AccountInfo) -> Result<Commodity> {
    require_keys_eq!(*info.owner, crate::ID, PegDeskError::InvalidLegs);
    let data = info.try_borrow_data()?;
    Commodity::try_deserialize(&mut &data[..]).map_err(|_| error!(PegDeskError::InvalidLegs))
}

/// Read one leg of an index. Legs may not themselves be Composite or EUR-quoted (no fx slot).
fn read_leg(
    leg: &Commodity,
    leg_key: &Pubkey,
    source: &AccountInfo,
    clock: &Clock,
) -> Result<OraclePrice> {
    require!(leg.status != STATUS_HALTED, PegDeskError::MarketHalted);
    let kind = leg
        .oracle_kind_enum()
        .ok_or_else(|| error!(PegDeskError::InvalidLegs))?;
    let max_age = leg.max_age();
    let out = match kind {
        OracleKind::PythPull => {
            require!(leg.quote_scale != QUOTE_EUR, PegDeskError::InvalidLegs);
            read_pyth_commodity(leg, source, None, max_age, clock)?
        }
        OracleKind::KeeperSigned => read_keeper_price(source, leg_key)?,
        OracleKind::Switchboard => read_switchboard(leg, leg_key, source)?,
        OracleKind::Composite => return err!(PegDeskError::InvalidLegs),
    };
    require!(
        age_secs(clock, out.publish_time) <= max_age as u64,
        PegDeskError::StaleOracle
    );
    require!(out.price > 0, PegDeskError::NonPositivePrice);
    Ok(out)
}

fn read_composite(
    c: &Commodity,
    commodity_key: &Pubkey,
    remaining: &[AccountInfo],
    clock: &Clock,
) -> Result<OraclePrice> {
    let legs = c.active_legs();
    let n = legs.len();
    require!(n > 0, PegDeskError::InvalidLegs);
    require!(remaining.len() >= n * 2, PegDeskError::InvalidLegs);

    let mut prices = [(0u64, 0u16); MAX_LEGS];
    let mut confs = [(0u64, 0u16); MAX_LEGS];
    let mut min_pt = i64::MAX;

    for (i, leg) in legs.iter().enumerate() {
        let leg_info = &remaining[2 * i];
        let source = &remaining[2 * i + 1];
        require_keys_eq!(*leg_info.key, leg.commodity, PegDeskError::InvalidLegs);
        require_keys_neq!(*leg_info.key, *commodity_key, PegDeskError::InvalidLegs);

        let leg_c = load_commodity(leg_info)?;
        let p = read_leg(&leg_c, leg_info.key, source, clock)?;
        prices[i] = (p.price, leg.weight_bps);
        confs[i] = (p.conf, leg.weight_bps);
        min_pt = min_pt.min(p.publish_time);
    }

    let price =
        pricing::weighted_sum(&prices[..n]).ok_or_else(|| error!(PegDeskError::InvalidLegs))?;
    let conf =
        pricing::weighted_sum(&confs[..n]).ok_or_else(|| error!(PegDeskError::InvalidLegs))?;
    Ok(OraclePrice {
        price,
        conf,
        publish_time: min_pt,
    })
}
