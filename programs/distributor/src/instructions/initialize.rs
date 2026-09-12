use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DistError;
use crate::events::DistConfigUpdated;
use crate::state::DistConfig;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: this program's executable account (audit F-09).
    #[account(address = crate::ID @ DistError::NotUpgradeAuthority)]
    pub program: UncheckedAccount<'info>,
    /// CHECK: this program's ProgramData PDA (validated in the handler; ignored for non-upgradeable loaders).
    pub program_data: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = 8 + DistConfig::INIT_SPACE, seeds = [DIST_SEED], bump)]
    pub dist_config: Box<Account<'info, DistConfig>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    fee_router: Pubkey,
    max_push_per_epoch_bps: u16,
) -> Result<()> {
    require_upgrade_authority(&ctx.accounts.program.to_account_info(), &ctx.accounts.program_data.to_account_info(), &ctx.accounts.payer.key())?;
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

/// Audit F-09 (init front-running): a singleton config may only be initialised by the program's
/// upgrade authority. `program` is this program's executable account; `program_data` its
/// BPFLoaderUpgradeable ProgramData PDA. Programs loaded at genesis on a local validator are owned
/// by the non-upgradeable loader and have no ProgramData — the check is skipped there.
pub fn require_upgrade_authority(
    program: &AccountInfo,
    program_data: &AccountInfo,
    payer: &Pubkey,
) -> Result<()> {
    let loader = anchor_lang::solana_program::bpf_loader_upgradeable::id();
    if *program.owner != loader {
        return Ok(());
    }
    let (expected, _) = Pubkey::find_program_address(&[program.key.as_ref()], &loader);
    require_keys_eq!(*program_data.key, expected, DistError::NotUpgradeAuthority);
    let data = program_data.try_borrow_data()?;
    // bincode UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
    // = u32 variant (3) | u64 slot | u8 option tag | [u8; 32]
    require!(
        data.len() >= 45 && data[0..4] == [3, 0, 0, 0] && data[12] == 1,
        DistError::NotUpgradeAuthority
    );
    let mut key = [0u8; 32];
    key.copy_from_slice(&data[13..45]);
    require_keys_eq!(Pubkey::new_from_array(key), *payer, DistError::NotUpgradeAuthority);
    Ok(())
}
