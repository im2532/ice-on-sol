use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DistError;
use crate::events::EpochFinalized;
use crate::state::{DistConfig, Epoch};

#[derive(Accounts)]
pub struct FinalizeEpoch<'info> {
    pub keeper: Signer<'info>,

    #[account(seeds = [DIST_SEED], bump = dist_config.bump)]
    pub dist_config: Box<Account<'info, DistConfig>>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, epoch.pool.as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump
    )]
    pub epoch: Box<Account<'info, Epoch>>,
}

/// Posts the Merkle root for the un-pushed remainder. `merkle_total` ≤ total − pushed; any slack is swept later.
pub fn handle_finalize_epoch(
    ctx: Context<FinalizeEpoch>,
    merkle_root: [u8; 32],
    merkle_total: u64,
) -> Result<()> {
    let cfg = &ctx.accounts.dist_config;
    require!(!cfg.paused, DistError::Paused);
    require!(
        cfg.is_admin_or_keeper(ctx.accounts.keeper.key),
        DistError::Unauthorized
    );

    let e = &mut ctx.accounts.epoch;
    require!(!e.finalized, DistError::AlreadyFinalized);
    let remainder = e
        .total_amount
        .checked_sub(e.pushed_amount)
        .ok_or(error!(DistError::MathOverflow))?;
    require!(merkle_total <= remainder, DistError::ExceedsRemainder);

    e.merkle_root = merkle_root;
    e.merkle_total = merkle_total;
    e.finalized = true;

    emit!(EpochFinalized {
        pool: e.pool,
        index: e.index,
        merkle_root,
        remainder
    });
    Ok(())
}
