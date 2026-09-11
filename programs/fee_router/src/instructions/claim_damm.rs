use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::cpi_ext::damm_v2;
use crate::errors::RouterError;
use crate::events::FeesClaimed;
use crate::instructions::common::{check_claim_gate, split, SplitCtx};
use crate::state::{PoolState, RouterConfig};

/// DBC-migrated DAMM v2 pools have token_a = base (memecoin), token_b = quote (COIN).
/// VERIFY ORDER vs IDL / `migrate_damm_v2` (DBC passes base_mint as token_a_mint).
/// MVP: base side is forwarded to treasury[base_mint]; v1.1 swaps it to COIN before the split.
#[derive(Accounts)]
pub struct ClaimDamm<'info> {
    pub caller: Signer<'info>,

    #[account(seeds = [ROUTER_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool_state.dbc_pool.as_ref()],
        bump = pool_state.bump,
        has_one = damm_pool,
        has_one = damm_position,
        has_one = base_mint,
        has_one = quote_mint,
        constraint = pool_state.migrated @ RouterError::MigrationNotRecorded
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    /// CHECK: DAMM v2 pool authority — validated by DAMM v2.
    pub damm_pool_authority: UncheckedAccount<'info>,
    /// CHECK: bound via pool_state.has_one.
    #[account(mut)]
    pub damm_pool: UncheckedAccount<'info>,
    /// CHECK: bound via pool_state.has_one.
    #[account(mut)]
    pub damm_position: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 validates pool.token_a_vault.
    #[account(mut)]
    pub token_a_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 validates pool.token_b_vault.
    #[account(mut)]
    pub token_b_vault: UncheckedAccount<'info>,

    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = position_nft_account.mint == pool_state.position_nft_mint @ RouterError::InvalidPositionNft,
        constraint = position_nft_account.owner == config.key() @ RouterError::InvalidPositionNft
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [TREASURY_SEED, base_mint.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = config
    )]
    pub treasury_base: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = config,
        associated_token::token_program = quote_token_program
    )]
    pub router_quote_recv: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [HOLDER_VAULT_SEED, pool_state.dbc_pool.as_ref()],
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

    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,

    /// CHECK: DAMM v2 PDA["__event_authority"] — validated by DAMM v2.
    pub damm_event_authority: UncheckedAccount<'info>,
    /// CHECK: must be the real DAMM v2 program (router PDA signs this CPI).
    #[account(address = DAMM_V2_PROGRAM_ID @ RouterError::InvalidProgram)]
    pub damm_program: UncheckedAccount<'info>,
}

pub fn handle_claim_damm(ctx: Context<ClaimDamm>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.config.paused, RouterError::Paused);
    check_claim_gate(
        &ctx.accounts.config,
        ctx.accounts.caller.key,
        ctx.accounts.pool_state.last_claim_ts,
        now,
    )?;

    let quote_before = ctx.accounts.router_quote_recv.amount;
    let base_before = ctx.accounts.treasury_base.amount;
    let router_bump = ctx.accounts.config.bump;
    {
        let a = &ctx.accounts;
        let bump = [router_bump];
        let seeds: &[&[&[u8]]] = &[&[ROUTER_SEED, &bump]];
        damm_v2::claim_position_fee(
            damm_v2::ClaimPositionFee {
                pool_authority: a.damm_pool_authority.to_account_info(),
                pool: a.damm_pool.to_account_info(),
                position: a.damm_position.to_account_info(),
                token_a_account: a.treasury_base.to_account_info(),
                token_b_account: a.router_quote_recv.to_account_info(),
                token_a_vault: a.token_a_vault.to_account_info(),
                token_b_vault: a.token_b_vault.to_account_info(),
                token_a_mint: a.base_mint.to_account_info(),
                token_b_mint: a.quote_mint.to_account_info(),
                position_nft_account: a.position_nft_account.to_account_info(),
                owner: a.config.to_account_info(),
                token_a_program: a.base_token_program.to_account_info(),
                token_b_program: a.quote_token_program.to_account_info(),
                event_authority: a.damm_event_authority.to_account_info(),
                program: a.damm_program.to_account_info(),
            },
            seeds,
        )?;
    }

    ctx.accounts.router_quote_recv.reload()?;
    ctx.accounts.treasury_base.reload()?;
    let quote_amount = ctx
        .accounts
        .router_quote_recv
        .amount
        .saturating_sub(quote_before);
    let base_amount = ctx
        .accounts
        .treasury_base
        .amount
        .saturating_sub(base_before);
    let pool_key = ctx.accounts.pool_state.dbc_pool;
    emit!(FeesClaimed {
        pool: pool_key,
        source: SOURCE_DAMM,
        quote_amount,
        base_amount
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
    ps.last_claim_ts = now;
    split(s, ps, pool_key, quote_amount)
}
