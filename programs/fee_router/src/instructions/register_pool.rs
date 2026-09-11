use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::PoolRegistered;
use crate::instructions::common::read_pubkey;
use crate::state::{PoolState, RouterConfig};

/// Shared by `register_pool` (permissionless, byte-level validation of the DBC accounts) and
/// `register_pool_admin` (admin override: skips layout checks, e.g. if a DBC upgrade moves offsets).
#[derive(Accounts)]
pub struct RegisterPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [ROUTER_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,

    /// CHECK: DBC VirtualPool. Owner checked here; layout checked in the handler.
    #[account(owner = DBC_PROGRAM_ID @ RouterError::InvalidDbcAccount)]
    pub dbc_pool: UncheckedAccount<'info>,

    /// CHECK: DBC PoolConfig. Owner checked here; layout checked in the handler.
    #[account(owner = DBC_PROGRAM_ID @ RouterError::InvalidDbcAccount)]
    pub dbc_config: UncheckedAccount<'info>,

    /// CHECK: peg_desk Commodity. Owner + coin_mint checked in the handler (permissionless path).
    pub commodity: UncheckedAccount<'info>,

    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    /// COIN
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        space = 8 + PoolState::INIT_SPACE,
        seeds = [POOL_SEED, dbc_pool.key().as_ref()],
        bump
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    #[account(
        init,
        payer = payer,
        seeds = [HOLDER_VAULT_SEED, dbc_pool.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = pool_state,
        token::token_program = quote_token_program
    )]
    pub holder_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        seeds = [BUYBACK_VAULT_SEED, quote_mint.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = config,
        token::token_program = quote_token_program
    )]
    pub buyback_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        seeds = [TREASURY_SEED, quote_mint.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = config,
        token::token_program = quote_token_program
    )]
    pub treasury_quote: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Receives any base-token fees (DBC `token_a_account`, DAMM v2 base side). MVP: stays in treasury.
    #[account(
        init_if_needed,
        payer = payer,
        seeds = [TREASURY_SEED, base_mint.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = config,
        token::token_program = base_token_program
    )]
    pub treasury_base: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Router's temporary receiving ATA for COIN (shared per coin; claims split the delta only).
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = quote_mint,
        associated_token::authority = config,
        associated_token::token_program = quote_token_program
    )]
    pub router_quote_recv: Box<InterfaceAccount<'info, TokenAccount>>,

    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Validates the DBC config/pool bytes and the Commodity account; returns the pool creator.
fn validate_permissionless(ctx: &Context<RegisterPool>) -> Result<Pubkey> {
    let a = &ctx.accounts;
    let router_key = a.config.key();

    {
        let data = a.dbc_config.try_borrow_data()?;
        require!(
            data.len() >= dbc_layout::CONFIG_MIN_LEN
                && data[..8] == dbc_layout::POOL_CONFIG_DISCRIMINATOR,
            RouterError::InvalidDbcAccount
        );
        let fee_claimer = read_pubkey(&data[..], dbc_layout::CONFIG_FEE_CLAIMER_OFFSET)?;
        require_keys_eq!(fee_claimer, router_key, RouterError::FeeClaimerMismatch);
        let cfg_quote = read_pubkey(&data[..], dbc_layout::CONFIG_QUOTE_MINT_OFFSET)?;
        require_keys_eq!(
            cfg_quote,
            a.quote_mint.key(),
            RouterError::QuoteMintMismatch
        );
    }

    let creator = {
        let data = a.dbc_pool.try_borrow_data()?;
        require!(
            data.len() >= dbc_layout::POOL_MIN_LEN
                && data[..8] == dbc_layout::VIRTUAL_POOL_DISCRIMINATOR,
            RouterError::InvalidDbcAccount
        );
        let pool_cfg = read_pubkey(&data[..], dbc_layout::POOL_CONFIG_OFFSET)?;
        require_keys_eq!(pool_cfg, a.dbc_config.key(), RouterError::ConfigMismatch);
        let pool_base = read_pubkey(&data[..], dbc_layout::POOL_BASE_MINT_OFFSET)?;
        require_keys_eq!(pool_base, a.base_mint.key(), RouterError::BaseMintMismatch);
        read_pubkey(&data[..], dbc_layout::POOL_CREATOR_OFFSET)?
    };

    {
        require!(
            a.config.peg_desk_program != Pubkey::default()
                && *a.commodity.owner == a.config.peg_desk_program,
            RouterError::InvalidCommodity
        );
        let data = a.commodity.try_borrow_data()?;
        require!(
            data.len() >= peg_desk_layout::COMMODITY_MIN_LEN,
            RouterError::InvalidCommodity
        );
        let coin_mint = read_pubkey(&data[..], peg_desk_layout::COMMODITY_COIN_MINT_OFFSET)?;
        require_keys_eq!(coin_mint, a.quote_mint.key(), RouterError::InvalidCommodity);
    }

    Ok(creator)
}

fn write_pool_state(ctx: Context<RegisterPool>, creator: Pubkey, fee_bps: u16) -> Result<()> {
    require!(!ctx.accounts.config.paused, RouterError::Paused);
    require!(fee_bps <= MAX_FEE_BPS, RouterError::InvalidFeeBps);

    let bump = ctx.bumps.pool_state;
    let a = ctx.accounts;
    let ps = &mut a.pool_state;
    ps.dbc_pool = a.dbc_pool.key();
    ps.dbc_config = a.dbc_config.key();
    ps.base_mint = a.base_mint.key();
    ps.quote_mint = a.quote_mint.key();
    ps.commodity = a.commodity.key();
    ps.creator = creator;
    ps.fee_bps = fee_bps;
    ps.migrated = false;
    ps.damm_pool = Pubkey::default();
    ps.damm_position = Pubkey::default();
    ps.position_nft_mint = Pubkey::default();
    ps.total_claimed = 0;
    ps.total_to_holders = 0;
    ps.total_to_buyback = 0;
    ps.total_to_protocol = 0;
    ps.last_claim_ts = 0;
    ps.bump = bump;
    ps._reserved = [0u8; 64];

    emit!(PoolRegistered {
        pool: ps.dbc_pool,
        base_mint: ps.base_mint,
        quote_mint: ps.quote_mint,
        commodity: ps.commodity,
        fee_bps,
    });
    Ok(())
}

/// Permissionless. Called by the launch builder right after DBC init.
/// `fee_bps` is informational (fees are enforced by the DBC config itself).
pub fn handle_register_pool(ctx: Context<RegisterPool>, fee_bps: u16) -> Result<()> {
    let creator = validate_permissionless(&ctx)?;
    write_pool_state(ctx, creator, fee_bps)
}

/// Admin override: registers without byte-level DBC/Commodity layout checks (owner == DBC still enforced).
pub fn handle_register_pool_admin(
    ctx: Context<RegisterPool>,
    fee_bps: u16,
    creator: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.payer.key(),
        ctx.accounts.config.admin,
        RouterError::Unauthorized
    );
    write_pool_state(ctx, creator, fee_bps)
}
