use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::cpi_ext::dbc;
use crate::errors::RouterError;
use crate::events::FeesClaimed;
use crate::instructions::common::{split, SplitCtx};
use crate::state::{PoolState, RouterConfig};

#[derive(Accounts)]
pub struct ClaimDbcSurplus<'info> {
    pub keeper: Signer<'info>,

    #[account(seeds = [ROUTER_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,

    #[account(
        mut,
        seeds = [POOL_SEED, dbc_pool.key().as_ref()],
        bump = pool_state.bump,
        has_one = dbc_pool,
        has_one = dbc_config,
        has_one = quote_mint
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    /// CHECK: DBC pool authority PDA — validated by DBC.
    pub dbc_pool_authority: UncheckedAccount<'info>,
    /// CHECK: bound via pool_state.has_one.
    pub dbc_config: UncheckedAccount<'info>,
    /// CHECK: bound via pool_state.has_one.
    #[account(mut)]
    pub dbc_pool: UncheckedAccount<'info>,
    /// CHECK: DBC validates pool.quote_vault.
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,

    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = config,
        associated_token::token_program = quote_token_program
    )]
    pub router_quote_recv: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [HOLDER_VAULT_SEED, dbc_pool.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = pool_state
    )]
    pub holder_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [BUYBACK_VAULT_SEED, quote_mint.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = config
    )]
    pub buyback_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [TREASURY_SEED, quote_mint.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = config
    )]
    pub treasury_quote: Box<InterfaceAccount<'info, TokenAccount>>,

    pub quote_token_program: Interface<'info, TokenInterface>,

    /// CHECK: DBC PDA["__event_authority"] — validated by DBC.
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: must be the real DBC program.
    #[account(address = DBC_PROGRAM_ID @ RouterError::InvalidProgram)]
    pub dbc_program: UncheckedAccount<'info>,
}

pub fn handle_claim_dbc_surplus(ctx: Context<ClaimDbcSurplus>) -> Result<()> {
    require!(!ctx.accounts.config.paused, RouterError::Paused);
    require!(
        ctx.accounts
            .config
            .is_admin_or_keeper(ctx.accounts.keeper.key),
        RouterError::Unauthorized
    );

    let quote_before = ctx.accounts.router_quote_recv.amount;
    let router_bump = ctx.accounts.config.bump;
    {
        let a = &ctx.accounts;
        let bump = [router_bump];
        let seeds: &[&[&[u8]]] = &[&[ROUTER_SEED, &bump]];
        dbc::partner_withdraw_surplus(
            dbc::PartnerWithdrawSurplus {
                pool_authority: a.dbc_pool_authority.to_account_info(),
                config: a.dbc_config.to_account_info(),
                virtual_pool: a.dbc_pool.to_account_info(),
                token_quote_account: a.router_quote_recv.to_account_info(),
                quote_vault: a.quote_vault.to_account_info(),
                quote_mint: a.quote_mint.to_account_info(),
                fee_claimer: a.config.to_account_info(),
                token_quote_program: a.quote_token_program.to_account_info(),
                event_authority: a.dbc_event_authority.to_account_info(),
                program: a.dbc_program.to_account_info(),
            },
            seeds,
        )?;
    }

    ctx.accounts.router_quote_recv.reload()?;
    let quote_amount = ctx
        .accounts
        .router_quote_recv
        .amount
        .saturating_sub(quote_before);
    let pool_key = ctx.accounts.pool_state.dbc_pool;
    emit!(FeesClaimed {
        pool: pool_key,
        source: SOURCE_SURPLUS,
        quote_amount,
        base_amount: 0
    });

    let s = SplitCtx {
        router: ctx.accounts.config.to_account_info(),
        source: ctx.accounts.router_quote_recv.to_account_info(),
        holder_vault: ctx.accounts.holder_vault.to_account_info(),
        buyback_vault: ctx.accounts.buyback_vault.to_account_info(),
        treasury: ctx.accounts.treasury_quote.to_account_info(),
        mint: ctx.accounts.quote_mint.to_account_info(),
        token_program: ctx.accounts.quote_token_program.to_account_info(),
        decimals: ctx.accounts.quote_mint.decimals,
        router_bump,
        holders_bps: ctx.accounts.config.holders_bps,
        buyback_bps: ctx.accounts.config.buyback_bps,
    };
    let ps = &mut ctx.accounts.pool_state;
    split(s, ps, pool_key, quote_amount)
}
