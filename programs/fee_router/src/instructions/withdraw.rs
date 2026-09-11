use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::VaultWithdrawn;
use crate::state::{PoolState, RouterConfig};

fn expected_program_signer(seed: &[u8], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[seed], program).0
}

// ------------------------------------------------------------------------------------------------
// withdraw_for_epoch — CPI-only from the distributor; signer must be distributor PDA["dist_auth"].
// ------------------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct WithdrawForEpoch<'info> {
    /// Distributor program's PDA["dist_auth"] (signs via invoke_signed inside the distributor).
    pub dist_authority: Signer<'info>,

    #[account(seeds = [ROUTER_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,

    #[account(
        seeds = [POOL_SEED, pool_state.dbc_pool.as_ref()],
        bump = pool_state.bump,
        has_one = quote_mint
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    #[account(
        mut,
        seeds = [HOLDER_VAULT_SEED, pool_state.dbc_pool.as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = pool_state
    )]
    pub holder_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = quote_mint)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw_for_epoch(ctx: Context<WithdrawForEpoch>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, RouterError::Paused);
    require!(amount > 0, RouterError::ZeroAmount);
    require_keys_eq!(
        a.dist_authority.key(),
        expected_program_signer(DIST_AUTH_SEED, &a.config.distributor_program),
        RouterError::InvalidAuthority
    );
    require!(
        a.holder_vault.amount >= amount,
        RouterError::InsufficientVault
    );

    let dbc_pool = a.pool_state.dbc_pool;
    let bump = [a.pool_state.bump];
    let seeds: &[&[&[u8]]] = &[&[POOL_SEED, dbc_pool.as_ref(), &bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            TransferChecked {
                from: a.holder_vault.to_account_info(),
                mint: a.quote_mint.to_account_info(),
                to: a.destination.to_account_info(),
                authority: a.pool_state.to_account_info(),
            },
            seeds,
        ),
        amount,
        a.quote_mint.decimals,
    )?;

    emit!(VaultWithdrawn {
        vault: a.holder_vault.key(),
        mint: a.quote_mint.key(),
        destination: a.destination.key(),
        amount,
        kind: WITHDRAW_EPOCH,
    });
    Ok(())
}

// ------------------------------------------------------------------------------------------------
// withdraw_for_buyback — CPI-only from the buyback program; signer must be buyback PDA["bb_auth"].
// ------------------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct WithdrawForBuyback<'info> {
    /// Buyback program's PDA["bb_auth"].
    pub bb_authority: Signer<'info>,

    #[account(seeds = [ROUTER_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,

    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [BUYBACK_VAULT_SEED, coin_mint.key().as_ref()],
        bump,
        token::mint = coin_mint,
        token::authority = config
    )]
    pub buyback_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = coin_mint)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw_for_buyback(ctx: Context<WithdrawForBuyback>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.paused, RouterError::Paused);
    require!(amount > 0, RouterError::ZeroAmount);
    require_keys_eq!(
        a.bb_authority.key(),
        expected_program_signer(BB_AUTH_SEED, &a.config.buyback_program),
        RouterError::InvalidAuthority
    );
    require!(
        a.buyback_vault.amount >= amount,
        RouterError::InsufficientVault
    );

    let bump = [a.config.bump];
    let seeds: &[&[&[u8]]] = &[&[ROUTER_SEED, &bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            TransferChecked {
                from: a.buyback_vault.to_account_info(),
                mint: a.coin_mint.to_account_info(),
                to: a.destination.to_account_info(),
                authority: a.config.to_account_info(),
            },
            seeds,
        ),
        amount,
        a.coin_mint.decimals,
    )?;

    emit!(VaultWithdrawn {
        vault: a.buyback_vault.key(),
        mint: a.coin_mint.key(),
        destination: a.destination.key(),
        amount,
        kind: WITHDRAW_BUYBACK,
    });
    Ok(())
}

// ------------------------------------------------------------------------------------------------
// withdraw_treasury — admin moves protocol revenue (treasury[mint], any mint incl. base tokens).
// ------------------------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    pub admin: Signer<'info>,

    #[account(seeds = [ROUTER_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Box<Account<'info, RouterConfig>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [TREASURY_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = config
    )]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(amount > 0, RouterError::ZeroAmount);
    require!(a.treasury.amount >= amount, RouterError::InsufficientVault);

    let bump = [a.config.bump];
    let seeds: &[&[&[u8]]] = &[&[ROUTER_SEED, &bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            TransferChecked {
                from: a.treasury.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.destination.to_account_info(),
                authority: a.config.to_account_info(),
            },
            seeds,
        ),
        amount,
        a.mint.decimals,
    )?;

    emit!(VaultWithdrawn {
        vault: a.treasury.key(),
        mint: a.mint.key(),
        destination: a.destination.key(),
        amount,
        kind: WITHDRAW_TREASURY,
    });
    Ok(())
}
