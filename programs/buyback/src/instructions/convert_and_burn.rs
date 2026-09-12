//! `convert_and_burn` v2 (CONTRACTS §4a): COIN → USDC (peg_desk sell) → ICE (forwarded swap route) → burn,
//! all in one instruction so no funds ever rest in a keeper-controlled account.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::cpi_ext;
use crate::errors::BuybackError;
use crate::events::Buyback;
use crate::state::BuybackState;

/// remaining_accounts: the swap route's accounts, in the router's order (Jupiter `/swap-instructions`
/// for `userPublicKey = bb_auth`, `inputMint = USDC`, `outputMint = ICE`, destination = `bb_ice`).
#[derive(Accounts)]
pub struct ConvertAndBurn<'info> {
    pub keeper: Signer<'info>,

    #[account(mut, seeds = [STATE_SEED], bump = state.bump)]
    pub state: Box<Account<'info, BuybackState>>,

    /// CHECK: PDA["bb_auth"].
    #[account(seeds = [BB_AUTH_SEED], bump = state.auth_bump)]
    pub bb_auth: UncheckedAccount<'info>,

    // ---- mints ----
    /// `mut`: peg_desk `sell` burns COIN, so the mint must be writable for the CPI to be allowed.
    #[account(mut)]
    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = state.usdc_mint @ BuybackError::InvalidMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = state.ice_mint @ BuybackError::InvalidMint)]
    pub ice_mint: Box<InterfaceAccount<'info, Mint>>,

    // ---- work accounts (ATAs of bb_auth; created idempotently by the keeper beforehand) ----
    #[account(mut, associated_token::mint = coin_mint, associated_token::authority = bb_auth, associated_token::token_program = token_program)]
    pub bb_coin: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = bb_auth, associated_token::token_program = token_program)]
    pub bb_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = ice_mint, associated_token::authority = bb_auth, associated_token::token_program = ice_token_program)]
    pub bb_ice: Box<InterfaceAccount<'info, TokenAccount>>,

    // ---- fee_router side ----
    /// CHECK: must be the configured fee_router program.
    #[account(address = state.fee_router @ BuybackError::InvalidProgram)]
    pub fee_router_program: UncheckedAccount<'info>,
    /// CHECK: fee_router RouterConfig PDA — validated by fee_router.
    pub router_config: UncheckedAccount<'info>,
    /// fee_router buyback_vault[coin] — seeds validated by fee_router; read here for the buffer.
    #[account(mut, token::mint = coin_mint)]
    pub buyback_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // ---- peg_desk side (all validated by peg_desk itself) ----
    /// CHECK: must be the configured peg_desk program.
    #[account(address = state.peg_desk @ BuybackError::InvalidProgram)]
    pub peg_desk_program: UncheckedAccount<'info>,
    /// CHECK: peg_desk GlobalConfig.
    pub peg_config: UncheckedAccount<'info>,
    /// CHECK: peg_desk Commodity for `coin_mint`.
    #[account(mut)]
    pub commodity: UncheckedAccount<'info>,
    /// CHECK: peg_desk PDA["mint_auth"].
    pub mint_auth: UncheckedAccount<'info>,
    /// CHECK: commodity reserve vault (USDC).
    #[account(mut)]
    pub reserve_vault: UncheckedAccount<'info>,
    /// CHECK: optional oracle accounts — pass `peg_desk_program` for None (Anchor convention).
    pub price_feed: UncheckedAccount<'info>,
    /// CHECK: see price_feed.
    pub fx_feed: UncheckedAccount<'info>,
    /// CHECK: see price_feed.
    pub keeper_price: UncheckedAccount<'info>,

    // ---- swap side ----
    /// CHECK: must be the configured swap router program (Jupiter v6 on mainnet).
    #[account(address = state.swap_program @ BuybackError::InvalidProgram)]
    pub swap_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub ice_token_program: Interface<'info, TokenInterface>,
}

/// ICE base units received per 1 USDC (1e6 base units), rounded down.
fn rate_per_usdc(ice_out: u64, usdc_in: u64) -> Option<u64> {
    if usdc_in == 0 {
        return None;
    }
    u64::try_from((ice_out as u128).checked_mul(USDC_UNIT)? / usdc_in as u128).ok()
}

/// Next anchor (audit F-01/F-02): the anchor only ever moves UP automatically, by at most
/// `move_bps` of the current anchor towards a better executed rate. It never moves down on a
/// keeper-executed cycle — a compromised keeper could otherwise walk it to zero 2 % per cycle.
/// Downward moves (genuine ICE repricing) are an admin `set_params.ice_per_usdc_anchor`.
/// An anchor of 0 is never accepted as a cycle input (see `handle_convert_and_burn`).
pub fn next_anchor(anchor: u64, rate: u64, move_bps: u16) -> u64 {
    if rate <= anchor {
        return anchor;
    }
    let step = (((anchor as u128) * (move_bps as u128) / (BPS_DENOM as u128)) as u64).max(1);
    anchor.saturating_add(step).min(rate)
}

/// Minimum acceptable rate given the anchor: anchor × (1 − max_deviation_bps). 0 when unanchored.
pub fn min_rate(anchor: u64, max_deviation_bps: u16) -> u64 {
    ((anchor as u128) * ((BPS_DENOM - max_deviation_bps as u64) as u128) / (BPS_DENOM as u128)) as u64
}

pub fn handle_convert_and_burn<'info>(
    ctx: Context<'_, '_, '_, 'info, ConvertAndBurn<'info>>,
    coin_amount: u64,
    min_usdc_out: u64,
    min_ice_out: u64,
    route_data: Vec<u8>,
) -> Result<()> {
    let st = &ctx.accounts.state;
    require!(!st.paused, BuybackError::Paused);
    // Audit F-02: the breaker must be armed before any vault funds move.
    require!(st.ice_per_usdc_anchor > 0, BuybackError::Unanchored);
    require!(st.max_per_cycle_usdc > 0, BuybackError::CycleCapUnset);
    require!(
        st.is_admin_or_keeper(ctx.accounts.keeper.key),
        BuybackError::Unauthorized
    );
    require!(
        route_data.len() <= MAX_ROUTE_DATA_LEN,
        BuybackError::RouteTooLong
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now.saturating_sub(st.last_cycle_ts) >= st.min_interval_secs as i64,
        BuybackError::TooSoon
    );

    // Amount = min(requested, vault × (1 − reserve_buffer)).
    let vault_bal = ctx.accounts.buyback_vault.amount;
    let usable = ((vault_bal as u128) * ((BPS_DENOM - st.reserve_buffer_bps as u64) as u128)
        / (BPS_DENOM as u128)) as u64;
    let coin_amount = coin_amount.min(usable);
    require!(coin_amount > 0, BuybackError::ZeroAmount);

    let auth_bump = [st.auth_bump];
    let seeds: &[&[&[u8]]] = &[&[BB_AUTH_SEED, &auth_bump]];

    // 1) pull COIN from fee_router into bb_coin
    let coin_before = ctx.accounts.bb_coin.amount;
    cpi_ext::withdraw_for_buyback(
        cpi_ext::WithdrawForBuyback {
            fee_router_program: ctx.accounts.fee_router_program.to_account_info(),
            bb_authority: ctx.accounts.bb_auth.to_account_info(),
            router_config: ctx.accounts.router_config.to_account_info(),
            coin_mint: ctx.accounts.coin_mint.to_account_info(),
            buyback_vault: ctx.accounts.buyback_vault.to_account_info(),
            destination: ctx.accounts.bb_coin.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        coin_amount,
        seeds,
    )?;
    ctx.accounts.bb_coin.reload()?;
    require!(
        ctx.accounts.bb_coin.amount.saturating_sub(coin_before) == coin_amount,
        BuybackError::WithdrawMismatch
    );

    // 2) sell COIN → USDC at the Peg Desk (bb_auth is the user)
    let usdc_before = ctx.accounts.bb_usdc.amount;
    cpi_ext::peg_desk_sell(
        cpi_ext::PegDeskSell {
            peg_desk_program: ctx.accounts.peg_desk_program.to_account_info(),
            user: ctx.accounts.bb_auth.to_account_info(),
            config: ctx.accounts.peg_config.to_account_info(),
            commodity: ctx.accounts.commodity.to_account_info(),
            coin_mint: ctx.accounts.coin_mint.to_account_info(),
            mint_auth: ctx.accounts.mint_auth.to_account_info(),
            reserve_vault: ctx.accounts.reserve_vault.to_account_info(),
            user_usdc: ctx.accounts.bb_usdc.to_account_info(),
            user_coin: ctx.accounts.bb_coin.to_account_info(),
            price_feed: ctx.accounts.price_feed.to_account_info(),
            fx_feed: ctx.accounts.fx_feed.to_account_info(),
            keeper_price: ctx.accounts.keeper_price.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        coin_amount,
        min_usdc_out,
        seeds,
    )?;
    ctx.accounts.bb_usdc.reload()?;
    ctx.accounts.bb_coin.reload()?;
    let usdc_out = ctx.accounts.bb_usdc.amount.saturating_sub(usdc_before);
    require!(
        usdc_out > 0 && usdc_out >= min_usdc_out,
        BuybackError::SellBelowMinimum
    );
    if st.max_per_cycle_usdc > 0 {
        // The sell already happened; a cap breach reverts the whole instruction (keeper sizes coin_amount).
        require!(
            usdc_out <= st.max_per_cycle_usdc,
            BuybackError::CycleCapExceeded
        );
    }
    let coin_after_sell = ctx.accounts.bb_coin.amount;

    // 3) USDC → ICE through the configured router, bb_auth signing as the route's user
    let ice_before = ctx.accounts.bb_ice.amount;
    let usdc_pre_swap = ctx.accounts.bb_usdc.amount;
    cpi_ext::invoke_route(
        &ctx.accounts.swap_program.to_account_info(),
        ctx.remaining_accounts,
        ctx.accounts.bb_auth.key,
        &route_data,
        seeds,
    )?;
    ctx.accounts.bb_ice.reload()?;
    ctx.accounts.bb_usdc.reload()?;
    ctx.accounts.bb_coin.reload()?;
    let ice_out = ctx.accounts.bb_ice.amount.saturating_sub(ice_before);
    let usdc_spent = usdc_pre_swap.saturating_sub(ctx.accounts.bb_usdc.amount);
    // Audit F-03/F-04: the route must consume (almost) exactly what this cycle sold — no
    // under-spending that strands USDC in bb_usdc, no dust cycles that steer the breaker — and may
    // additionally drain residue left by earlier cycles (bounded by the per-cycle cap).
    let min_spend = ((usdc_out as u128) * ((BPS_DENOM - MIN_SPEND_TOLERANCE_BPS) as u128)
        / (BPS_DENOM as u128)) as u64;
    require!(usdc_spent >= min_spend.max(1), BuybackError::UsdcUnderspent);
    require!(usdc_spent <= usdc_pre_swap, BuybackError::UsdcOverspent);
    require!(usdc_spent <= st.max_per_cycle_usdc, BuybackError::CycleCapExceeded);
    require!(
        ctx.accounts.bb_coin.amount == coin_after_sell,
        BuybackError::UsdcOverspent
    );
    require!(
        ice_out > 0 && ice_out >= min_ice_out,
        BuybackError::SlippageExceeded
    );

    // Rate breaker: the executed ICE-per-USDC must be within max_deviation_bps of the anchor.
    let rate = rate_per_usdc(ice_out, usdc_spent).ok_or(error!(BuybackError::MathOverflow))?;
    require!(rate > 0, BuybackError::RateBelowAnchor);
    require!(
        rate >= min_rate(st.ice_per_usdc_anchor, st.max_deviation_bps),
        BuybackError::RateBelowAnchor
    );

    // 4) burn everything bought
    token_interface::burn(
        CpiContext::new_with_signer(
            ctx.accounts.ice_token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.ice_mint.to_account_info(),
                from: ctx.accounts.bb_ice.to_account_info(),
                authority: ctx.accounts.bb_auth.to_account_info(),
            },
            seeds,
        ),
        ice_out,
    )?;

    let coin_key = ctx.accounts.coin_mint.key();
    let s = &mut ctx.accounts.state;
    s.ice_per_usdc_anchor = next_anchor(s.ice_per_usdc_anchor, rate, s.anchor_move_bps);
    s.last_cycle_ts = now;
    s.total_usdc_out = s
        .total_usdc_out
        .checked_add(usdc_spent)
        .ok_or(error!(BuybackError::MathOverflow))?;
    s.total_ice_burned = s
        .total_ice_burned
        .checked_add(ice_out)
        .ok_or(error!(BuybackError::MathOverflow))?;

    emit!(Buyback {
        coin: coin_key,
        coin_amount,
        usdc_out: usdc_spent,
        ice_burned: ice_out,
        rate,
        anchor: s.ice_per_usdc_anchor,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_is_ice_per_one_usdc() {
        // 2,000 ICE (6 dp) for 10 USDC → 200 ICE per USDC
        assert_eq!(rate_per_usdc(2_000_000_000, 10_000_000), Some(200_000_000));
        assert_eq!(rate_per_usdc(1, 0), None);
    }

    #[test]
    fn anchor_only_ratchets_up_and_at_most_move_bps_per_cycle() {
        assert_eq!(next_anchor(10_000, 20_000, 200), 10_200); // +2% cap
        assert_eq!(next_anchor(10_000, 10_100, 200), 10_100); // within the step: lands exactly
        assert_eq!(next_anchor(10_000, 5_000, 200), 10_000); // never down on an executed cycle
        assert_eq!(next_anchor(10_000, 9_950, 200), 10_000);
        assert_eq!(next_anchor(10, 100, 200), 11); // step floors at 1 so tiny anchors can recover
    }

    #[test]
    fn min_rate_from_anchor() {
        assert_eq!(min_rate(0, 500), 0); // unanchored — handler refuses to run in this state
        assert_eq!(min_rate(10_000, 500), 9_500);
        assert_eq!(min_rate(10_000, 0), 10_000);
    }
}
