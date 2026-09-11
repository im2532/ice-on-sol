use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::cpi_ext;
use crate::errors::BuybackError;
use crate::events::Buyback;
use crate::state::BuybackState;

/// MVP: GLD path only. 1) pull GLD from fee_router buyback_vault[GLD] (CPI, bb_auth signs),
/// 2) swap GLD→ICEmarkets on the DAMM v2 ICE/GLD pool (CPI, bb_auth is `payer`), 3) burn the ICEmarkets received.
/// `gld_is_token_a` tells which side of the DAMM pool GLD is (keeper reads it off-chain; a wrong value
/// makes DAMM reject the vault/mint pairing, so it cannot misroute funds).
#[derive(Accounts)]
pub struct ConvertAndBurn<'info> {
    pub keeper: Signer<'info>,

    #[account(mut, seeds = [STATE_SEED], bump = state.bump)]
    pub state: Box<Account<'info, BuybackState>>,

    /// CHECK: PDA["bb_auth"].
    #[account(seeds = [BB_AUTH_SEED], bump = state.auth_bump)]
    pub bb_auth: UncheckedAccount<'info>,

    // ---- fee_router side ----
    /// CHECK: must be the configured fee_router program.
    #[account(address = state.fee_router @ BuybackError::InvalidProgram)]
    pub fee_router_program: UncheckedAccount<'info>,
    /// CHECK: fee_router RouterConfig PDA — validated by fee_router.
    pub router_config: UncheckedAccount<'info>,
    /// fee_router buyback_vault[GLD] — seeds validated by fee_router; read here for the buffer.
    #[account(mut, token::mint = gld_mint)]
    pub buyback_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // ---- mints / work accounts ----
    #[account(address = state.gld_mint @ BuybackError::UnsupportedCoin)]
    pub gld_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = state.ice_mint @ BuybackError::InvalidPool)]
    pub ice_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = gld_mint,
        associated_token::authority = bb_auth,
        associated_token::token_program = gld_token_program
    )]
    pub bb_gld: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = ice_mint,
        associated_token::authority = bb_auth,
        associated_token::token_program = ice_token_program
    )]
    pub bb_icemarkets: Box<InterfaceAccount<'info, TokenAccount>>,

    // ---- DAMM v2 side ----
    /// CHECK: DAMM v2 pool authority — validated by DAMM v2.
    pub damm_pool_authority: UncheckedAccount<'info>,
    /// CHECK: configured ICE/GLD pool.
    #[account(mut, address = state.ice_pool @ BuybackError::InvalidPool, owner = DAMM_V2_PROGRAM_ID @ BuybackError::InvalidPool)]
    pub damm_pool: UncheckedAccount<'info>,
    /// CHECK: validated by DAMM v2 (pool.token_a_vault).
    #[account(mut)]
    pub damm_token_a_vault: UncheckedAccount<'info>,
    /// CHECK: validated by DAMM v2 (pool.token_b_vault).
    #[account(mut)]
    pub damm_token_b_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 PDA["__event_authority"].
    pub damm_event_authority: UncheckedAccount<'info>,
    /// CHECK: must be the real DAMM v2 program (bb_auth signs this CPI).
    #[account(address = DAMM_V2_PROGRAM_ID @ BuybackError::InvalidProgram)]
    pub damm_program: UncheckedAccount<'info>,

    pub gld_token_program: Interface<'info, TokenInterface>,
    pub ice_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_convert_and_burn(
    ctx: Context<ConvertAndBurn>,
    amount: u64,
    min_ice_out: u64,
    gld_is_token_a: bool,
) -> Result<()> {
    let st = &ctx.accounts.state;
    require!(!st.paused, BuybackError::Paused);
    require!(
        st.is_admin_or_keeper(ctx.accounts.keeper.key),
        BuybackError::Unauthorized
    );

    // Amount = min(requested, max_per_cycle, vault × (1 − reserve_buffer)).
    let vault_bal = ctx.accounts.buyback_vault.amount;
    let usable = ((vault_bal as u128) * ((BPS_DENOM - st.reserve_buffer_bps as u64) as u128)
        / (BPS_DENOM as u128)) as u64;
    let mut gld_amount = amount.min(usable);
    if st.max_per_cycle > 0 {
        gld_amount = gld_amount.min(st.max_per_cycle);
    }
    require!(gld_amount > 0, BuybackError::ZeroAmount);

    let auth_bump = [st.auth_bump];
    let seeds: &[&[&[u8]]] = &[&[BB_AUTH_SEED, &auth_bump]];

    // 1) pull GLD from fee_router
    let gld_before = ctx.accounts.bb_gld.amount;
    cpi_ext::withdraw_for_buyback(
        cpi_ext::WithdrawForBuyback {
            fee_router_program: ctx.accounts.fee_router_program.to_account_info(),
            bb_authority: ctx.accounts.bb_auth.to_account_info(),
            router_config: ctx.accounts.router_config.to_account_info(),
            coin_mint: ctx.accounts.gld_mint.to_account_info(),
            buyback_vault: ctx.accounts.buyback_vault.to_account_info(),
            destination: ctx.accounts.bb_gld.to_account_info(),
            token_program: ctx.accounts.gld_token_program.to_account_info(),
        },
        gld_amount,
        seeds,
    )?;
    ctx.accounts.bb_gld.reload()?;
    let received = ctx.accounts.bb_gld.amount.saturating_sub(gld_before);
    require!(received == gld_amount, BuybackError::WithdrawMismatch);

    // 2) swap GLD → ICEmarkets on DAMM v2
    let ice_before = ctx.accounts.bb_icemarkets.amount;
    {
        let a = &ctx.accounts;
        let (a_mint, b_mint, a_prog, b_prog) = if gld_is_token_a {
            (
                a.gld_mint.to_account_info(),
                a.ice_mint.to_account_info(),
                a.gld_token_program.to_account_info(),
                a.ice_token_program.to_account_info(),
            )
        } else {
            (
                a.ice_mint.to_account_info(),
                a.gld_mint.to_account_info(),
                a.ice_token_program.to_account_info(),
                a.gld_token_program.to_account_info(),
            )
        };
        cpi_ext::damm_swap(
            cpi_ext::DammSwap {
                pool_authority: a.damm_pool_authority.to_account_info(),
                pool: a.damm_pool.to_account_info(),
                input_token_account: a.bb_gld.to_account_info(),
                output_token_account: a.bb_icemarkets.to_account_info(),
                token_a_vault: a.damm_token_a_vault.to_account_info(),
                token_b_vault: a.damm_token_b_vault.to_account_info(),
                token_a_mint: a_mint,
                token_b_mint: b_mint,
                payer: a.bb_auth.to_account_info(),
                token_a_program: a_prog,
                token_b_program: b_prog,
                event_authority: a.damm_event_authority.to_account_info(),
                program: a.damm_program.to_account_info(),
            },
            gld_amount,
            min_ice_out,
            seeds,
        )?;
    }
    ctx.accounts.bb_icemarkets.reload()?;
    let ice_out = ctx.accounts.bb_icemarkets.amount.saturating_sub(ice_before);
    require!(
        ice_out >= min_ice_out && ice_out > 0,
        BuybackError::SlippageExceeded
    );

    // 3) burn everything bought
    token_interface::burn(
        CpiContext::new_with_signer(
            ctx.accounts.ice_token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.ice_mint.to_account_info(),
                from: ctx.accounts.bb_icemarkets.to_account_info(),
                authority: ctx.accounts.bb_auth.to_account_info(),
            },
            seeds,
        ),
        ice_out,
    )?;

    let gld_key = ctx.accounts.gld_mint.key();
    let s = &mut ctx.accounts.state;
    s.total_gld_in = s
        .total_gld_in
        .checked_add(gld_amount)
        .ok_or(error!(BuybackError::MathOverflow))?;
    s.total_ice_burned = s
        .total_ice_burned
        .checked_add(ice_out)
        .ok_or(error!(BuybackError::MathOverflow))?;

    emit!(Buyback {
        coin: gld_key,
        coin_amount: gld_amount,
        gld_amount,
        ice_burned: ice_out
    });
    Ok(())
}
