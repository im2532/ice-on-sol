use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::cpi_ext::dbc;
use crate::errors::RouterError;
use crate::events::FeesClaimed;
use crate::instructions::common::{check_claim_gate, split, SplitCtx};
use crate::state::{PoolState, RouterConfig};

/// Accounts shared by the split (holder/buyback/treasury vaults) are validated by seeds here.
#[derive(Accounts)]
pub struct ClaimDbc<'info> {
    /// Keeper, admin, or anyone once `PERMISSIONLESS_CLAIM_INTERVAL` has elapsed.
    pub caller: Signer<'info>,

    #[account(seeds = [ROUTER_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,

    #[account(
        mut,
        seeds = [POOL_SEED, dbc_pool.key().as_ref()],
        bump = pool_state.bump,
        has_one = dbc_pool,
        has_one = dbc_config,
        has_one = base_mint,
        has_one = quote_mint
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    /// CHECK: DBC pool authority PDA — validated by DBC.
    pub dbc_pool_authority: UncheckedAccount<'info>,
    /// CHECK: bound via pool_state.has_one; DBC validates pool.config == config.
    pub dbc_config: UncheckedAccount<'info>,
    /// CHECK: bound via pool_state.has_one.
    #[account(mut)]
    pub dbc_pool: UncheckedAccount<'info>,
    /// CHECK: DBC validates pool.base_vault.
    #[account(mut)]
    pub base_vault: UncheckedAccount<'info>,
    /// CHECK: DBC validates pool.quote_vault.
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,

    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// DBC `token_a_account` (base). max_base_amount = 0, so normally unchanged.
    #[account(
        mut,
        seeds = [TREASURY_SEED, base_mint.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = config
    )]
    pub treasury_base: Box<InterfaceAccount<'info, TokenAccount>>,

    /// DBC `token_b_account` (quote). Router's receiving ATA.
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

    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,

    /// CHECK: DBC PDA["__event_authority"] — validated by DBC.
    pub dbc_event_authority: UncheckedAccount<'info>,
    /// CHECK: must be the real DBC program (the router PDA signs this CPI).
    #[account(address = DBC_PROGRAM_ID @ RouterError::InvalidProgram)]
    pub dbc_program: UncheckedAccount<'info>,
}

pub fn handle_claim_dbc(ctx: Context<ClaimDbc>) -> Result<()> {
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
        dbc::claim_trading_fee(
            dbc::ClaimTradingFee {
                pool_authority: a.dbc_pool_authority.to_account_info(),
                config: a.dbc_config.to_account_info(),
                pool: a.dbc_pool.to_account_info(),
                token_a_account: a.treasury_base.to_account_info(),
                token_b_account: a.router_quote_recv.to_account_info(),
                base_vault: a.base_vault.to_account_info(),
                quote_vault: a.quote_vault.to_account_info(),
                base_mint: a.base_mint.to_account_info(),
                quote_mint: a.quote_mint.to_account_info(),
                fee_claimer: a.config.to_account_info(),
                token_base_program: a.base_token_program.to_account_info(),
                token_quote_program: a.quote_token_program.to_account_info(),
                event_authority: a.dbc_event_authority.to_account_info(),
                program: a.dbc_program.to_account_info(),
            },
            0,        // max_base_amount: fees are collected in quote (collectFeeMode = 0)
            u64::MAX, // max_quote_amount: claim everything
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
        source: SOURCE_DBC,
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
