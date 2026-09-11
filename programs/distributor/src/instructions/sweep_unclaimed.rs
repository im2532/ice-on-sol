use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::DistError;
use crate::events::EpochSwept;
use crate::state::{DistConfig, Epoch};

#[derive(Accounts)]
pub struct SweepUnclaimed<'info> {
    pub admin: Signer<'info>,

    #[account(seeds = [DIST_SEED], bump = dist_config.bump, has_one = admin @ DistError::Unauthorized)]
    pub dist_config: Box<Account<'info, DistConfig>>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, epoch.pool.as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump,
        has_one = coin_mint
    )]
    pub epoch: Box<Account<'info, Epoch>>,

    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = epoch,
        associated_token::token_program = token_program
    )]
    pub epoch_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// fee_router treasury[coin_mint] — PDA checked in the handler against `dist_config.fee_router`.
    #[account(mut, token::mint = coin_mint)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// After `end_ts + 180d` (claims are closed from then on), moves whatever is left in the epoch vault
/// (unclaimed Merkle amounts + any slack between merkle_total and the remainder) to treasury.
pub fn handle_sweep_unclaimed(ctx: Context<SweepUnclaimed>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let e = &ctx.accounts.epoch;
    require!(
        now > e.end_ts.saturating_add(SWEEP_DELAY_SECS),
        DistError::SweepTooEarly
    );

    let (expected_treasury, _) = Pubkey::find_program_address(
        &[ROUTER_TREASURY_SEED, e.coin_mint.as_ref()],
        &ctx.accounts.dist_config.fee_router,
    );
    require_keys_eq!(
        ctx.accounts.treasury.key(),
        expected_treasury,
        DistError::InvalidTreasury
    );

    let amount = ctx.accounts.epoch_vault.amount;
    let pool = e.pool;
    let index = e.index;
    let index_le = e.index.to_le_bytes();
    let epoch_bump = [e.bump];
    let seeds: &[&[&[u8]]] = &[&[EPOCH_SEED, pool.as_ref(), &index_le, &epoch_bump]];

    if amount > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.epoch_vault.to_account_info(),
                    mint: ctx.accounts.coin_mint.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.epoch.to_account_info(),
                },
                seeds,
            ),
            amount,
            ctx.accounts.coin_mint.decimals,
        )?;
    }

    // Mark everything as settled so indexers see a closed epoch.
    let e = &mut ctx.accounts.epoch;
    e.finalized = true;

    emit!(EpochSwept {
        pool,
        index,
        amount,
        treasury: expected_treasury
    });
    Ok(())
}
