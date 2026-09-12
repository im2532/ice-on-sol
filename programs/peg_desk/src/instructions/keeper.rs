//! KeeperSigned price feed: keeper_update_price (+ admin set_keeper_bounds).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::PegDeskError;
use crate::events::{ParamsUpdated, PriceUpdated};
use crate::instructions::admin::{is_keeper, require_admin};
use crate::state::*;

#[derive(Accounts)]
pub struct KeeperUpdatePrice<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [COMMODITY_SEED, commodity.symbol.as_ref()],
        bump = commodity.bump
    )]
    pub commodity: Box<Account<'info, Commodity>>,

    /// Created on first update with DEFAULT_MAX_MOVE_BPS / DEFAULT_MIN_INTERVAL.
    #[account(
        init_if_needed,
        payer = keeper,
        space = 8 + KeeperPrice::INIT_SPACE,
        seeds = [KEEPER_PRICE_SEED, commodity.key().as_ref()],
        bump
    )]
    pub keeper_price: Box<Account<'info, KeeperPrice>>,

    pub system_program: Program<'info, System>,
}

/// `price` / `conf` are USD at 1e8 (the keeper applies any unit conversion off-chain).
pub fn handle_keeper_update_price(
    ctx: Context<KeeperUpdatePrice>,
    price: u64,
    conf: u64,
    publish_time: i64,
    source_hash: [u8; 32],
) -> Result<()> {
    require!(
        is_keeper(&ctx.accounts.config, &ctx.accounts.keeper.key()),
        PegDeskError::Unauthorized
    );
    // KeeperSigned; Switchboard also accepted while it is backed by the KeeperPrice stand-in.
    let kind = ctx.accounts.commodity.oracle_kind;
    require!(
        kind == OracleKind::KeeperSigned as u8 || kind == OracleKind::Switchboard as u8,
        PegDeskError::InvalidOracleKind
    );
    require!(price > 0, PegDeskError::NonPositivePrice);
    require!(conf < price, PegDeskError::ConfidenceTooWide);

    let now = Clock::get()?.unix_timestamp;
    require!(
        publish_time >= 0 && publish_time <= now.saturating_add(MAX_FUTURE_SKEW_SECS),
        PegDeskError::InvalidParams
    );

    let commodity_key = ctx.accounts.commodity.key();
    let kp = &mut ctx.accounts.keeper_price;

    if kp.commodity == Pubkey::default() {
        // First write (account just created by init_if_needed).
        kp.commodity = commodity_key;
        kp.max_move_bps = DEFAULT_MAX_MOVE_BPS;
        kp.min_interval = DEFAULT_MIN_INTERVAL;
        kp.bump = ctx.bumps.keeper_price;
    } else {
        require_keys_eq!(kp.commodity, commodity_key, PegDeskError::InvalidFeed);
    }

    if kp.publish_time != 0 {
        // Feed time must be strictly newer (monotonic guard) …
        require!(
            publish_time > kp.publish_time,
            PegDeskError::OracleNotMonotonic
        );
        // … and — audit F-05 — the spacing is enforced on the VALIDATOR clock, so a keeper cannot
        // pack N max-move posts into one slot by choosing its own timestamps.
        let elapsed_chain = now.saturating_sub(kp.last_update_ts);
        require!(
            elapsed_chain >= kp.min_interval.max(1) as i64,
            PegDeskError::TooSoon
        );
    }

    if kp.price > 0 {
        let diff = price.abs_diff(kp.price) as u128;
        let move_bps = diff * BPS as u128 / kp.price as u128;
        require!(
            move_bps <= kp.max_move_bps as u128,
            PegDeskError::MoveTooLarge
        );
    }

    kp.price = price;
    kp.conf = conf;
    kp.publish_time = publish_time;
    kp.source_hash = source_hash;
    kp.last_update_ts = now;

    emit!(PriceUpdated {
        commodity: commodity_key,
        price,
        conf,
        publish_time,
    });
    Ok(())
}

// ---- set_keeper_bounds (addition to CONTRACTS.md) --------------------------------------------

#[derive(Accounts)]
pub struct SetKeeperBounds<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PegDeskError::Unauthorized
    )]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(
        seeds = [COMMODITY_SEED, commodity.symbol.as_ref()],
        bump = commodity.bump
    )]
    pub commodity: Box<Account<'info, Commodity>>,

    #[account(
        mut,
        seeds = [KEEPER_PRICE_SEED, commodity.key().as_ref()],
        bump = keeper_price.bump
    )]
    pub keeper_price: Box<Account<'info, KeeperPrice>>,
}

pub fn handle_set_keeper_bounds(
    ctx: Context<SetKeeperBounds>,
    max_move_bps: u16,
    min_interval: u32,
) -> Result<()> {
    require_admin(&ctx.accounts.config, &ctx.accounts.admin.key())?;
    require!(min_interval >= 1, PegDeskError::InvalidParams);
    require!(
        max_move_bps > 0 && (max_move_bps as u64) <= BPS,
        PegDeskError::InvalidParams
    );
    let kp = &mut ctx.accounts.keeper_price;
    kp.max_move_bps = max_move_bps;
    kp.min_interval = min_interval;
    emit!(ParamsUpdated {
        commodity: ctx.accounts.commodity.key(),
    });
    Ok(())
}
