use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DistError;
use crate::events::DistConfigUpdated;
use crate::state::DistConfig;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + DistConfig::INIT_SPACE, seeds = [DIST_SEED], bump)]
    pub dist_config: Box<Account<'info, DistConfig>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    fee_router: Pubkey,
    max_push_per_epoch_bps: u16,
) -> Result<()> {
    require!(
        max_push_per_epoch_bps as u64 <= BPS_DENOM,
        DistError::InvalidBps
    );
    let c = &mut ctx.accounts.dist_config;
    c.admin = ctx.accounts.payer.key();
    c.keepers = [Pubkey::default(); 8];
    c.keeper_count = 0;
    c.fee_router = fee_router;
    c.max_push_per_epoch_bps = max_push_per_epoch_bps;
    c.paused = false;
    c.bump = ctx.bumps.dist_config;
    emit!(DistConfigUpdated {
        admin: c.admin,
        fee_router,
        keeper_count: 0,
        max_push_per_epoch_bps,
        paused: false,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct DistAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [DIST_SEED], bump = dist_config.bump, has_one = admin @ DistError::Unauthorized)]
    pub dist_config: Box<Account<'info, DistConfig>>,
}

pub fn handle_set_keepers(ctx: Context<DistAdmin>, keepers: Vec<Pubkey>) -> Result<()> {
    require!(keepers.len() <= MAX_KEEPERS, DistError::TooManyKeepers);
    let c = &mut ctx.accounts.dist_config;
    let mut arr = [Pubkey::default(); 8];
    for (i, k) in keepers.iter().enumerate() {
        arr[i] = *k;
    }
    c.keepers = arr;
    c.keeper_count = keepers.len() as u8;
    emit!(DistConfigUpdated {
        admin: c.admin,
        fee_router: c.fee_router,
        keeper_count: c.keeper_count,
        max_push_per_epoch_bps: c.max_push_per_epoch_bps,
        paused: c.paused,
    });
    Ok(())
}

/// Not in CONTRACTS v0.1 (admin knobs). `None` leaves a field unchanged.
pub fn handle_set_params(
    ctx: Context<DistAdmin>,
    fee_router: Option<Pubkey>,
    max_push_per_epoch_bps: Option<u16>,
    paused: Option<bool>,
    new_admin: Option<Pubkey>,
) -> Result<()> {
    let c = &mut ctx.accounts.dist_config;
    if let Some(v) = fee_router {
        c.fee_router = v;
    }
    if let Some(v) = max_push_per_epoch_bps {
        require!(v as u64 <= BPS_DENOM, DistError::InvalidBps);
        c.max_push_per_epoch_bps = v;
    }
    if let Some(v) = paused {
        c.paused = v;
    }
    if let Some(v) = new_admin {
        c.admin = v;
    }
    emit!(DistConfigUpdated {
        admin: c.admin,
        fee_router: c.fee_router,
        keeper_count: c.keeper_count,
        max_push_per_epoch_bps: c.max_push_per_epoch_bps,
        paused: c.paused,
    });
    Ok(())
}
