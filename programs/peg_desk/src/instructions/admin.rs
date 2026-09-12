//! Global config: initialize_config, set_keepers, propose_admin, accept_admin, set_global_pause.

use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::constants::*;
use crate::errors::PegDeskError;
use crate::events::{AdminChanged, AdminProposed, ConfigInitialized, GlobalPauseSet, KeepersSet};
use crate::state::GlobalConfig;

// ---- access-control helpers (used by every instruction module) -----------------------------

pub fn is_admin(config: &GlobalConfig, key: &Pubkey) -> bool {
    config.is_admin(key)
}

pub fn is_keeper(config: &GlobalConfig, key: &Pubkey) -> bool {
    config.is_keeper(key)
}

pub fn require_admin(config: &GlobalConfig, key: &Pubkey) -> Result<()> {
    require!(is_admin(config, key), PegDeskError::Unauthorized);
    Ok(())
}

pub fn require_admin_or_keeper(config: &GlobalConfig, key: &Pubkey) -> Result<()> {
    require!(
        is_admin(config, key) || is_keeper(config, key),
        PegDeskError::Unauthorized
    );
    Ok(())
}

// ---- initialize_config ------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// Pays rent and becomes `admin`.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: this program's executable account (audit F-09).
    #[account(address = crate::ID @ PegDeskError::NotUpgradeAuthority)]
    pub program: UncheckedAccount<'info>,
    /// CHECK: this program's ProgramData PDA (validated in the handler; ignored for non-upgradeable loaders).
    pub program_data: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Box<Account<'info, GlobalConfig>>,

    /// USDC.
    #[account(constraint = reserve_mint.decimals == USDC_DECIMALS @ PegDeskError::InvalidParams)]
    pub reserve_mint: Box<Account<'info, Mint>>,

    /// CHECK: any wallet / PDA; owner of the treasury USDC token account. Stored only.
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(
    ctx: Context<InitializeConfig>,
    max_conf_bps: u16,
    reserve_warn_bps: u16,
    reserve_halt_bps: u16,
) -> Result<()> {
    require_upgrade_authority(&ctx.accounts.program.to_account_info(), &ctx.accounts.program_data.to_account_info(), &ctx.accounts.payer.key())?;
    require!(
        max_conf_bps > 0 && (max_conf_bps as u64) <= BPS,
        PegDeskError::InvalidParams
    );
    require!(
        reserve_halt_bps <= reserve_warn_bps,
        PegDeskError::InvalidParams
    );

    let cfg = &mut ctx.accounts.config;
    cfg.admin = ctx.accounts.payer.key();
    cfg.pending_admin = Pubkey::default();
    cfg.keepers = [Pubkey::default(); MAX_KEEPERS];
    cfg.keeper_count = 0;
    cfg.treasury = ctx.accounts.treasury.key();
    cfg.reserve_mint = ctx.accounts.reserve_mint.key();
    cfg.global_pause = false;
    cfg.max_conf_bps = max_conf_bps;
    cfg.reserve_warn_bps = reserve_warn_bps;
    cfg.reserve_halt_bps = reserve_halt_bps;
    cfg.bump = ctx.bumps.config;
    cfg.redeem_cap_exempt = Pubkey::default();
    cfg._reserved = [0u8; 32];

    emit!(ConfigInitialized {
        admin: cfg.admin,
        reserve_mint: cfg.reserve_mint,
        treasury: cfg.treasury,
    });
    Ok(())
}

// ---- admin-only config mutations ----------------------------------------------------------------

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PegDeskError::Unauthorized
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
}

pub fn handle_set_keepers(ctx: Context<AdminConfig>, keepers: Vec<Pubkey>) -> Result<()> {
    require!(keepers.len() <= MAX_KEEPERS, PegDeskError::TooManyKeepers);
    for (i, k) in keepers.iter().enumerate() {
        require!(*k != Pubkey::default(), PegDeskError::InvalidParams);
        require!(!keepers[..i].contains(k), PegDeskError::InvalidParams);
    }

    let cfg = &mut ctx.accounts.config;
    let mut arr = [Pubkey::default(); MAX_KEEPERS];
    arr[..keepers.len()].copy_from_slice(&keepers);
    cfg.keepers = arr;
    cfg.keeper_count = keepers.len() as u8;

    emit!(KeepersSet { keepers });
    Ok(())
}

pub fn handle_propose_admin(ctx: Context<AdminConfig>, new_admin: Pubkey) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    cfg.pending_admin = new_admin;
    emit!(AdminProposed {
        current: cfg.admin,
        pending: new_admin,
    });
    Ok(())
}

// ---- accept_admin -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin == pending_admin.key() @ PegDeskError::Unauthorized,
        constraint = config.pending_admin != Pubkey::default() @ PegDeskError::Unauthorized
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
}

pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    let old = cfg.admin;
    cfg.admin = ctx.accounts.pending_admin.key();
    cfg.pending_admin = Pubkey::default();
    emit!(AdminChanged {
        old_admin: old,
        new_admin: cfg.admin,
    });
    Ok(())
}

// ---- set_global_pause ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetGlobalPause<'info> {
    /// Admin or keeper. Keepers may only pause.
    pub authority: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
}

pub fn handle_set_global_pause(ctx: Context<SetGlobalPause>, paused: bool) -> Result<()> {
    let who = ctx.accounts.authority.key();
    let cfg = &mut ctx.accounts.config;
    if paused {
        require_admin_or_keeper(cfg, &who)?;
    } else {
        require_admin(cfg, &who)?;
    }
    cfg.global_pause = paused;
    emit!(GlobalPauseSet { paused, by: who });
    Ok(())
}

/// Admin: set (or clear with Pubkey::default()) the signer exempt from daily_redeem_cap.
pub fn handle_set_redeem_cap_exempt(ctx: Context<AdminConfig>, exempt: Pubkey) -> Result<()> {
    ctx.accounts.config.redeem_cap_exempt = exempt;
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
    require_keys_eq!(*program_data.key, expected, PegDeskError::NotUpgradeAuthority);
    let data = program_data.try_borrow_data()?;
    // bincode UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
    // = u32 variant (3) | u64 slot | u8 option tag | [u8; 32]
    require!(
        data.len() >= 45 && data[0..4] == [3, 0, 0, 0] && data[12] == 1,
        PegDeskError::NotUpgradeAuthority
    );
    let mut key = [0u8; 32];
    key.copy_from_slice(&data[13..45]);
    require_keys_eq!(Pubkey::new_from_array(key), *payer, PegDeskError::NotUpgradeAuthority);
    Ok(())
}
