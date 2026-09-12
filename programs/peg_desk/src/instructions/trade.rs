//! buy, buy_exact_out, sell, sweep_spread_fees, deposit_reserve.

#![allow(deprecated)] // anchor_spl::token::transfer (vs transfer_checked) — keeps the account list short.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::PegDeskError;
use crate::events::{ReserveAlert, ReserveDeposited, SpreadFeesSwept, Trade};
use crate::instructions::admin::require_admin_or_keeper;
use crate::oracle::{self, OracleAccounts};
use crate::pricing;
use crate::state::*;

const SIDE_BUY: u8 = 0;
const SIDE_SELL: u8 = 1;

// ---- accounts shared by buy / buy_exact_out / sell -------------------------------------------------

#[derive(Accounts)]
pub struct TradeAccounts<'info> {
    pub user: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [COMMODITY_SEED, commodity.symbol.as_ref()],
        bump = commodity.bump,
        has_one = coin_mint @ PegDeskError::InvalidParams,
        has_one = reserve_vault @ PegDeskError::InvalidParams
    )]
    pub commodity: Box<Account<'info, Commodity>>,

    #[account(mut)]
    pub coin_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA `["mint_auth"]`, signer for mint_to; holds no data.
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    #[account(mut)]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_usdc.mint == config.reserve_mint @ PegDeskError::InvalidParams,
        constraint = user_usdc.owner == user.key() @ PegDeskError::Unauthorized
    )]
    pub user_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_coin.mint == coin_mint.key() @ PegDeskError::InvalidParams,
        constraint = user_coin.owner == user.key() @ PegDeskError::Unauthorized
    )]
    pub user_coin: Box<Account<'info, TokenAccount>>,

    /// CHECK: PythPull → PriceUpdateV2 (== commodity.feed_account, owner = Pyth receiver);
    /// Switchboard → stand-in KeeperPrice at commodity.feed_account. Validated in oracle.rs.
    pub price_feed: Option<UncheckedAccount<'info>>,

    /// CHECK: EUR/USD PriceUpdateV2 for EUR-quoted feeds (== commodity.fx_feed_account).
    pub fx_feed: Option<UncheckedAccount<'info>>,

    /// CHECK: KeeperSigned → KeeperPrice PDA of this commodity (owner + discriminator + commodity
    /// field checked in oracle.rs).
    pub keeper_price: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
    // remaining_accounts (Composite only): [leg Commodity, leg price source] × leg_count
}

/// Everything a trade needs from the oracle + guards, computed before any transfer.
struct Quote {
    price: u64,
    publish_time: i64,
    spread_bps: u16,
    /// Validator clock at quote time (window accounting).
    now: i64,
}

fn quote<'info>(
    a: &TradeAccounts<'info>,
    remaining: &[AccountInfo<'info>],
    is_buy: bool,
    clock: &Clock,
) -> Result<Quote> {
    require!(!a.config.global_pause, PegDeskError::Paused);

    let c: &Commodity = &a.commodity;
    match c.status {
        STATUS_OPEN => {}
        STATUS_CLOSED => {
            // Closed = sell-only.
            require!(!is_buy, PegDeskError::MarketClosed);
        }
        STATUS_HALTED => return err!(PegDeskError::MarketHalted),
        _ => return err!(PegDeskError::InvalidStatus),
    }

    let price_feed = a.price_feed.as_ref().map(|x| x.to_account_info());
    let fx_feed = a.fx_feed.as_ref().map(|x| x.to_account_info());
    let keeper_price = a.keeper_price.as_ref().map(|x| x.to_account_info());
    let accts = OracleAccounts {
        price_feed: price_feed.as_ref(),
        fx_feed: fx_feed.as_ref(),
        keeper_price: keeper_price.as_ref(),
        remaining,
    };
    let op = oracle::read_price(c, &a.commodity.key(), &accts, clock)?;

    // No cherry-picking an older (but still fresh) update.
    require!(
        op.publish_time >= c.last_publish_time,
        PegDeskError::OracleNotMonotonic
    );
    let cbps =
        pricing::conf_bps(op.conf, op.price).ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    require!(
        cbps <= a.config.max_conf_bps as u64,
        PegDeskError::ConfidenceTooWide
    );

    // Circuit breaker: a jump vs the last accepted price (any oracle kind) is refused while the
    // anchor is fresh. Protects the reserve from a bad feed print / compromised keeper key.
    require!(
        pricing::deviation_ok(
            op.price,
            c.last_price,
            c.last_publish_time,
            clock.unix_timestamp,
            c.max_deviation_bps,
            c.deviation_window_secs,
        ),
        PegDeskError::PriceDeviationTooLarge
    );

    let pre_ratio =
        pricing::reserve_ratio_bps(a.reserve_vault.amount, a.coin_mint.supply, op.price);
    let spread_bps = pricing::effective_spread_bps(
        c.base_spread_bps,
        c.closed_spread_bps,
        c.conf_mult_bps,
        op.conf,
        op.price,
        oracle::age_secs(clock, op.publish_time),
        c.max_age(),
        c.status,
        pre_ratio,
        a.config.reserve_warn_bps,
    );

    Ok(Quote {
        price: op.price,
        publish_time: op.publish_time,
        spread_bps,
        now: clock.unix_timestamp,
    })
}

fn execute_buy(
    a: &mut TradeAccounts,
    mint_auth_bump: u8,
    q: &Quote,
    usdc_in: u64,
    coin_out: u64,
) -> Result<()> {
    require!(usdc_in > 0 && coin_out > 0, PegDeskError::ZeroAmount);
    require!(
        coin_out <= a.commodity.per_tx_cap,
        PegDeskError::PerTxCapExceeded
    );
    let new_supply = a
        .coin_mint
        .supply
        .checked_add(coin_out)
        .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    require!(
        new_supply <= a.commodity.supply_cap,
        PegDeskError::SupplyCapExceeded
    );
    let new_reserve = a
        .reserve_vault
        .amount
        .checked_add(usdc_in)
        .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    let post_ratio = pricing::reserve_ratio_bps(new_reserve, new_supply, q.price);
    require!(
        post_ratio >= a.config.reserve_halt_bps as u64,
        PegDeskError::ReserveRatioTooLow
    );

    // Circuit breaker: rolling daily mint cap.
    let (win_start, win_minted) = pricing::window_add(
        a.commodity.window_start,
        a.commodity.window_minted,
        q.now,
        DAILY_WINDOW_SECS,
        a.commodity.daily_mint_cap,
        coin_out,
    )
    .ok_or_else(|| error!(PegDeskError::DailyMintCapExceeded))?;
    if win_start != a.commodity.window_start {
        // New window: redemptions restart too.
        a.commodity.window_redeemed = 0;
    }
    a.commodity.window_start = win_start;
    a.commodity.window_minted = win_minted;

    // 1. USDC user → reserve vault.
    token::transfer(
        CpiContext::new(
            a.token_program.to_account_info(),
            Transfer {
                from: a.user_usdc.to_account_info(),
                to: a.reserve_vault.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        usdc_in,
    )?;

    // 2. Mint COIN to user, signed by the mint_auth PDA.
    let bump = [mint_auth_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            MintTo {
                mint: a.coin_mint.to_account_info(),
                to: a.user_coin.to_account_info(),
                authority: a.mint_auth.to_account_info(),
            },
            signer_seeds,
        ),
        coin_out,
    )?;

    a.reserve_vault.reload()?;
    let commodity_key = a.commodity.key();
    let user_key = a.user.key();
    let vault_amount = a.reserve_vault.amount;
    let warn = a.config.reserve_warn_bps as u64;

    let c = &mut a.commodity;
    c.reserve_balance_cached = vault_amount;
    c.last_publish_time = q.publish_time;
    c.last_price = q.price;

    emit!(Trade {
        commodity: commodity_key,
        user: user_key,
        side: SIDE_BUY,
        usdc: usdc_in,
        coin: coin_out,
        price: q.price,
        spread_bps: q.spread_bps,
    });
    if post_ratio < warn {
        emit!(ReserveAlert {
            commodity: commodity_key,
            ratio_bps: post_ratio,
        });
    }
    Ok(())
}

/// Spend exactly `usdc_in` USDC; receive at least `min_coin_out` COIN.
pub fn handle_buy<'info>(
    ctx: Context<'_, '_, '_, 'info, TradeAccounts<'info>>,
    usdc_in: u64,
    min_coin_out: u64,
) -> Result<()> {
    require!(usdc_in > 0, PegDeskError::ZeroAmount);
    let clock = Clock::get()?;
    let q = quote(ctx.accounts, ctx.remaining_accounts, true, &clock)?;

    let ask =
        pricing::ask(q.price, q.spread_bps).ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    let coin_out = pricing::coin_out_for_usdc(usdc_in, ask)
        .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    require!(coin_out >= min_coin_out, PegDeskError::SlippageExceeded);

    let bump = ctx.bumps.mint_auth;
    execute_buy(ctx.accounts, bump, &q, usdc_in, coin_out)
}

/// Receive exactly `coin_out` COIN; spend at most `max_usdc_in` USDC. Used by the launch builder.
pub fn handle_buy_exact_out<'info>(
    ctx: Context<'_, '_, '_, 'info, TradeAccounts<'info>>,
    coin_out: u64,
    max_usdc_in: u64,
) -> Result<()> {
    require!(coin_out > 0, PegDeskError::ZeroAmount);
    let clock = Clock::get()?;
    let q = quote(ctx.accounts, ctx.remaining_accounts, true, &clock)?;

    let ask =
        pricing::ask(q.price, q.spread_bps).ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    let usdc_in = pricing::usdc_in_for_coin(coin_out, ask)
        .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    require!(usdc_in <= max_usdc_in, PegDeskError::SlippageExceeded);

    let bump = ctx.bumps.mint_auth;
    execute_buy(ctx.accounts, bump, &q, usdc_in, coin_out)
}

/// Burn `coin_in` COIN; receive at least `min_usdc_out` USDC from the reserve.
/// Allowed while Open or Closed. The spread stays in the reserve (see sweep_spread_fees).
pub fn handle_sell<'info>(
    ctx: Context<'_, '_, '_, 'info, TradeAccounts<'info>>,
    coin_in: u64,
    min_usdc_out: u64,
) -> Result<()> {
    require!(coin_in > 0, PegDeskError::ZeroAmount);
    let clock = Clock::get()?;
    let q = quote(ctx.accounts, ctx.remaining_accounts, false, &clock)?;

    let bid =
        pricing::bid(q.price, q.spread_bps).ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    let usdc_out = pricing::usdc_out_for_coin(coin_in, bid)
        .ok_or_else(|| error!(PegDeskError::MathOverflow))?;
    require!(usdc_out > 0, PegDeskError::ZeroAmount);
    require!(usdc_out >= min_usdc_out, PegDeskError::SlippageExceeded);

    let a = ctx.accounts;
    require!(
        coin_in <= a.commodity.per_tx_cap,
        PegDeskError::PerTxCapExceeded
    );
    require!(
        usdc_out <= a.reserve_vault.amount,
        PegDeskError::ReserveInsufficient
    );

    // Circuit breaker: rolling daily redemption cap (USDC out). The buyback PDA is exempt (its
    // volume is capped by the buyback program); its sells still count towards the window.
    let exempt = a.config.redeem_cap_exempt != Pubkey::default()
        && a.user.key() == a.config.redeem_cap_exempt;
    let (win_start, win_redeemed) = pricing::window_add(
        a.commodity.window_start,
        a.commodity.window_redeemed,
        q.now,
        DAILY_WINDOW_SECS,
        if exempt { 0 } else { a.commodity.daily_redeem_cap },
        usdc_out,
    )
    .ok_or_else(|| error!(PegDeskError::DailyRedeemCapExceeded))?;
    if win_start != a.commodity.window_start {
        a.commodity.window_minted = 0;
    }
    a.commodity.window_start = win_start;
    a.commodity.window_redeemed = win_redeemed;

    // 1. Burn COIN from the user (user signs).
    token::burn(
        CpiContext::new(
            a.token_program.to_account_info(),
            Burn {
                mint: a.coin_mint.to_account_info(),
                from: a.user_coin.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        coin_in,
    )?;

    // 2. USDC reserve vault → user, signed by the commodity PDA.
    let symbol = a.commodity.symbol;
    let cbump = [a.commodity.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[COMMODITY_SEED, &symbol, &cbump]];
    token::transfer(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            Transfer {
                from: a.reserve_vault.to_account_info(),
                to: a.user_usdc.to_account_info(),
                authority: a.commodity.to_account_info(),
            },
            signer_seeds,
        ),
        usdc_out,
    )?;

    a.reserve_vault.reload()?;
    a.coin_mint.reload()?;
    let post_ratio =
        pricing::reserve_ratio_bps(a.reserve_vault.amount, a.coin_mint.supply, q.price);
    let commodity_key = a.commodity.key();
    let user_key = a.user.key();
    let vault_amount = a.reserve_vault.amount;
    let warn = a.config.reserve_warn_bps as u64;

    let c = &mut a.commodity;
    c.reserve_balance_cached = vault_amount;
    c.last_publish_time = q.publish_time;
    c.last_price = q.price;

    emit!(Trade {
        commodity: commodity_key,
        user: user_key,
        side: SIDE_SELL,
        usdc: usdc_out,
        coin: coin_in,
        price: q.price,
        spread_bps: q.spread_bps,
    });
    if post_ratio < warn {
        emit!(ReserveAlert {
            commodity: commodity_key,
            ratio_bps: post_ratio,
        });
    }
    Ok(())
}

// ---- sweep_spread_fees ----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SweepSpreadFees<'info> {
    /// Keeper (admin also accepted).
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [COMMODITY_SEED, commodity.symbol.as_ref()],
        bump = commodity.bump,
        has_one = coin_mint @ PegDeskError::InvalidParams,
        has_one = reserve_vault @ PegDeskError::InvalidParams
    )]
    pub commodity: Box<Account<'info, Commodity>>,

    /// Needed for outstanding supply in the reserve-ratio check.
    pub coin_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = treasury_usdc.mint == config.reserve_mint @ PegDeskError::InvalidParams,
        constraint = treasury_usdc.owner == config.treasury @ PegDeskError::Unauthorized
    )]
    pub treasury_usdc: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

/// Move `amount` of accumulated spread from the reserve to treasury. Only allowed if the reserve
/// ratio after the sweep stays ≥ `reserve_warn_bps` (102%), valued at the last accepted oracle
/// price, which must itself be within the commodity's current max age.
pub fn handle_sweep_spread_fees(ctx: Context<SweepSpreadFees>, amount: u64) -> Result<()> {
    let a = ctx.accounts;
    require_admin_or_keeper(&a.config, &a.authority.key())?;
    require!(!a.config.global_pause, PegDeskError::Paused);
    require!(amount > 0, PegDeskError::ZeroAmount);
    require!(
        amount <= a.reserve_vault.amount,
        PegDeskError::ReserveInsufficient
    );

    let supply = a.coin_mint.supply;
    let remaining = a.reserve_vault.amount - amount;
    if supply > 0 {
        let now = Clock::get()?.unix_timestamp;
        require!(a.commodity.last_price > 0, PegDeskError::StaleOracle);
        require!(
            oracle_age_ok(now, a.commodity.last_publish_time, a.commodity.max_age()),
            PegDeskError::StaleOracle
        );
        let ratio = pricing::reserve_ratio_bps(remaining, supply, a.commodity.last_price);
        require!(
            ratio >= a.config.reserve_warn_bps as u64,
            PegDeskError::ReserveRatioTooLow
        );
    }

    let symbol = a.commodity.symbol;
    let cbump = [a.commodity.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[COMMODITY_SEED, &symbol, &cbump]];
    token::transfer(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            Transfer {
                from: a.reserve_vault.to_account_info(),
                to: a.treasury_usdc.to_account_info(),
                authority: a.commodity.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    a.reserve_vault.reload()?;
    a.commodity.reserve_balance_cached = a.reserve_vault.amount;

    emit!(SpreadFeesSwept {
        commodity: a.commodity.key(),
        amount,
        treasury_usdc: a.treasury_usdc.key(),
    });
    Ok(())
}

fn oracle_age_ok(now: i64, publish_time: i64, max_age: u32) -> bool {
    now.saturating_sub(publish_time) <= max_age as i64
}

// ---- deposit_reserve --------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct DepositReserve<'info> {
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [COMMODITY_SEED, commodity.symbol.as_ref()],
        bump = commodity.bump,
        has_one = reserve_vault @ PegDeskError::InvalidParams
    )]
    pub commodity: Box<Account<'info, Commodity>>,

    #[account(mut)]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = from.mint == reserve_vault.mint @ PegDeskError::InvalidParams,
        constraint = from.owner == depositor.key() @ PegDeskError::Unauthorized
    )]
    pub from: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

/// Anyone may top up a commodity's reserve (seed capital, hedge P&L, …).
pub fn handle_deposit_reserve(ctx: Context<DepositReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, PegDeskError::ZeroAmount);
    let a = ctx.accounts;
    token::transfer(
        CpiContext::new(
            a.token_program.to_account_info(),
            Transfer {
                from: a.from.to_account_info(),
                to: a.reserve_vault.to_account_info(),
                authority: a.depositor.to_account_info(),
            },
        ),
        amount,
    )?;
    a.reserve_vault.reload()?;
    a.commodity.reserve_balance_cached = a.reserve_vault.amount;

    emit!(ReserveDeposited {
        commodity: a.commodity.key(),
        from: a.from.key(),
        amount,
    });
    Ok(())
}
