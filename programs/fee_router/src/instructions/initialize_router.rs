use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::RouterInitialized;
use crate::state::RouterConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeRouterArgs {
    pub distributor_program: Pubkey,
    pub buyback_program: Pubkey,
    pub peg_desk_program: Pubkey,
    pub holders_bps: u16,
    pub buyback_bps: u16,
    pub protocol_bps: u16,
}

#[derive(Accounts)]
pub struct InitializeRouter<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: this program's executable account (audit F-09).
    #[account(address = crate::ID @ RouterError::NotUpgradeAuthority)]
    pub program: UncheckedAccount<'info>,
    /// CHECK: this program's ProgramData PDA (validated in the handler; ignored for non-upgradeable loaders).
    pub program_data: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + RouterConfig::INIT_SPACE,
        seeds = [ROUTER_SEED],
        bump
    )]
    pub config: Box<Account<'info, RouterConfig>>,
    pub system_program: Program<'info, System>,
}

pub fn check_split(h: u16, b: u16, p: u16) -> Result<()> {
    let sum = (h as u64) + (b as u64) + (p as u64);
    require!(sum == BPS_DENOM, RouterError::InvalidSplit);
    Ok(())
}

pub fn handle_initialize_router(
    ctx: Context<InitializeRouter>,
    args: InitializeRouterArgs,
) -> Result<()> {
    require_upgrade_authority(&ctx.accounts.program.to_account_info(), &ctx.accounts.program_data.to_account_info(), &ctx.accounts.payer.key())?;
    check_split(args.holders_bps, args.buyback_bps, args.protocol_bps)?;
    let cfg = &mut ctx.accounts.config;
    cfg.admin = ctx.accounts.payer.key();
    cfg.keepers = [Pubkey::default(); 8];
    cfg.keeper_count = 0;
    cfg.distributor_program = args.distributor_program;
    cfg.buyback_program = args.buyback_program;
    cfg.peg_desk_program = args.peg_desk_program;
    cfg.holders_bps = args.holders_bps;
    cfg.buyback_bps = args.buyback_bps;
    cfg.protocol_bps = args.protocol_bps;
    cfg.paused = false;
    cfg.bump = ctx.bumps.config;
    cfg._reserved = [0u8; 32];

    emit!(RouterInitialized {
        admin: cfg.admin,
        distributor_program: cfg.distributor_program,
        buyback_program: cfg.buyback_program,
        holders_bps: cfg.holders_bps,
        buyback_bps: cfg.buyback_bps,
        protocol_bps: cfg.protocol_bps,
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
    require_keys_eq!(*program_data.key, expected, RouterError::NotUpgradeAuthority);
    let data = program_data.try_borrow_data()?;
    // bincode UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
    // = u32 variant (3) | u64 slot | u8 option tag | [u8; 32]
    require!(
        data.len() >= 45 && data[0..4] == [3, 0, 0, 0] && data[12] == 1,
        RouterError::NotUpgradeAuthority
    );
    let mut key = [0u8; 32];
    key.copy_from_slice(&data[13..45]);
    require_keys_eq!(Pubkey::new_from_array(key), *payer, RouterError::NotUpgradeAuthority);
    Ok(())
}
