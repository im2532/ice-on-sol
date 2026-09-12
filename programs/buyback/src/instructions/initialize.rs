use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::BuybackError;
use crate::events::BuybackParamsUpdated;
use crate::state::BuybackState;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    pub fee_router: Pubkey,
    pub peg_desk: Pubkey,
    /// Jupiter v6 on mainnet/devnet; any AMM program on localnet.
    pub swap_program: Pubkey,
    pub reserve_buffer_bps: u16,
    /// Must be > 0 (audit F-02).
    pub max_per_cycle_usdc: u64,
    pub max_deviation_bps: u16,
    pub anchor_move_bps: u16,
    pub min_interval_secs: u32,
    /// Must be > 0: ICE base units per 1 USDC from an off-chain reference (audit F-02).
    pub ice_per_usdc_anchor: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: this program's executable account (audit F-09).
    #[account(address = crate::ID @ BuybackError::NotUpgradeAuthority)]
    pub program: UncheckedAccount<'info>,
    /// CHECK: this program's ProgramData PDA (validated in the handler; ignored for non-upgradeable loaders).
    pub program_data: UncheckedAccount<'info>,

    #[account(init, payer = admin, space = 8 + BuybackState::INIT_SPACE, seeds = [STATE_SEED], bump)]
    pub state: Box<Account<'info, BuybackState>>,

    /// CHECK: PDA["bb_auth"]; holds no data.
    #[account(seeds = [BB_AUTH_SEED], bump)]
    pub bb_auth: UncheckedAccount<'info>,

    pub ice_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Work account: USDC from the Peg Desk sell lands here, then is swapped.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = usdc_mint,
        associated_token::authority = bb_auth,
        associated_token::token_program = usdc_token_program
    )]
    pub bb_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Work account: ICE bought lands here, then is burned.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = ice_mint,
        associated_token::authority = bb_auth,
        associated_token::token_program = ice_token_program
    )]
    pub bb_ice: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub ice_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

fn check_bps(v: u16) -> Result<()> {
    require!((v as u64) < BPS_DENOM, BuybackError::InvalidBps);
    Ok(())
}

fn emit_params(s: &BuybackState) {
    emit!(BuybackParamsUpdated {
        admin: s.admin,
        swap_program: s.swap_program,
        reserve_buffer_bps: s.reserve_buffer_bps,
        max_per_cycle_usdc: s.max_per_cycle_usdc,
        max_deviation_bps: s.max_deviation_bps,
        anchor_move_bps: s.anchor_move_bps,
        min_interval_secs: s.min_interval_secs,
        ice_per_usdc_anchor: s.ice_per_usdc_anchor,
        keeper_count: s.keeper_count,
        paused: s.paused,
    });
}

pub fn handle_initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    require_upgrade_authority(&ctx.accounts.program.to_account_info(), &ctx.accounts.program_data.to_account_info(), &ctx.accounts.admin.key())?;
    check_bps(args.reserve_buffer_bps)?;
    check_bps(args.max_deviation_bps)?;
    check_bps(args.anchor_move_bps)?;
    // Audit F-02: the breaker must be armed from the first cycle.
    require!(args.ice_per_usdc_anchor > 0, BuybackError::Unanchored);
    require!(args.max_per_cycle_usdc > 0, BuybackError::CycleCapUnset);
    let s = &mut ctx.accounts.state;
    s.admin = ctx.accounts.admin.key();
    s.keepers = [Pubkey::default(); 8];
    s.keeper_count = 0;
    s.fee_router = args.fee_router;
    s.peg_desk = args.peg_desk;
    s.swap_program = args.swap_program;
    s.ice_mint = ctx.accounts.ice_mint.key();
    s.usdc_mint = ctx.accounts.usdc_mint.key();
    s.reserve_buffer_bps = args.reserve_buffer_bps;
    s.max_per_cycle_usdc = args.max_per_cycle_usdc;
    s.min_interval_secs = args.min_interval_secs;
    s.last_cycle_ts = 0;
    s.ice_per_usdc_anchor = args.ice_per_usdc_anchor;
    s.max_deviation_bps = args.max_deviation_bps;
    s.anchor_move_bps = args.anchor_move_bps;
    s.paused = false;
    s.total_usdc_out = 0;
    s.total_ice_burned = 0;
    s.auth_bump = ctx.bumps.bb_auth;
    s.bump = ctx.bumps.state;
    s._reserved = [0u8; 64];
    emit_params(s);
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetParamsArgs {
    pub fee_router: Option<Pubkey>,
    pub peg_desk: Option<Pubkey>,
    pub swap_program: Option<Pubkey>,
    pub reserve_buffer_bps: Option<u16>,
    pub max_per_cycle_usdc: Option<u64>,
    pub max_deviation_bps: Option<u16>,
    pub anchor_move_bps: Option<u16>,
    pub min_interval_secs: Option<u32>,
    /// Admin override of the rate anchor (e.g. after a genuine ICE repricing).
    pub ice_per_usdc_anchor: Option<u64>,
    pub paused: Option<bool>,
    pub keepers: Option<Vec<Pubkey>>,
    pub new_admin: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct SetParams<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [STATE_SEED], bump = state.bump, has_one = admin @ BuybackError::Unauthorized)]
    pub state: Box<Account<'info, BuybackState>>,
}

pub fn handle_set_params(ctx: Context<SetParams>, args: SetParamsArgs) -> Result<()> {
    let s = &mut ctx.accounts.state;
    if let Some(v) = args.fee_router {
        s.fee_router = v;
    }
    if let Some(v) = args.peg_desk {
        s.peg_desk = v;
    }
    if let Some(v) = args.swap_program {
        s.swap_program = v;
    }
    if let Some(v) = args.reserve_buffer_bps {
        check_bps(v)?;
        s.reserve_buffer_bps = v;
    }
    if let Some(v) = args.max_per_cycle_usdc {
        require!(v > 0, BuybackError::CycleCapUnset);
        s.max_per_cycle_usdc = v;
    }
    if let Some(v) = args.max_deviation_bps {
        check_bps(v)?;
        s.max_deviation_bps = v;
    }
    if let Some(v) = args.anchor_move_bps {
        check_bps(v)?;
        s.anchor_move_bps = v;
    }
    if let Some(v) = args.min_interval_secs {
        s.min_interval_secs = v;
    }
    if let Some(v) = args.ice_per_usdc_anchor {
        require!(v > 0, BuybackError::Unanchored);
        s.ice_per_usdc_anchor = v;
    }
    if let Some(v) = args.paused {
        s.paused = v;
    }
    if let Some(keepers) = args.keepers {
        require!(keepers.len() <= MAX_KEEPERS, BuybackError::TooManyKeepers);
        let mut arr = [Pubkey::default(); 8];
        for (i, k) in keepers.iter().enumerate() {
            arr[i] = *k;
        }
        s.keepers = arr;
        s.keeper_count = keepers.len() as u8;
    }
    if let Some(v) = args.new_admin {
        s.admin = v;
    }
    emit_params(s);
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
    require_keys_eq!(*program_data.key, expected, BuybackError::NotUpgradeAuthority);
    let data = program_data.try_borrow_data()?;
    // bincode UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
    // = u32 variant (3) | u64 slot | u8 option tag | [u8; 32]
    require!(
        data.len() >= 45 && data[0..4] == [3, 0, 0, 0] && data[12] == 1,
        BuybackError::NotUpgradeAuthority
    );
    let mut key = [0u8; 32];
    key.copy_from_slice(&data[13..45]);
    require_keys_eq!(Pubkey::new_from_array(key), *payer, BuybackError::NotUpgradeAuthority);
    Ok(())
}

// ---- sweep_work_account (audit F-03): admin recovers residue from a bb_auth-owned ATA -------------

#[derive(Accounts)]
pub struct SweepWorkAccount<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [STATE_SEED], bump = state.bump, has_one = admin @ BuybackError::Unauthorized)]
    pub state: Box<Account<'info, BuybackState>>,
    /// CHECK: PDA["bb_auth"].
    #[account(seeds = [BB_AUTH_SEED], bump = state.auth_bump)]
    pub bb_auth: UncheckedAccount<'info>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bb_auth, associated_token::token_program = token_program)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Must be owned by the admin (the multisig vault) — residue is protocol revenue, never a third party's.
    #[account(mut, token::mint = mint, constraint = destination.owner == state.admin @ BuybackError::Unauthorized)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Moves `amount` (0 = everything) of a bb_auth work ATA to an admin-owned account. Cannot touch the
/// vaults in fee_router; only residue that a route left behind.
pub fn handle_sweep_work_account(ctx: Context<SweepWorkAccount>, amount: u64) -> Result<()> {
    let bal = ctx.accounts.source.amount;
    let amount = if amount == 0 { bal } else { amount.min(bal) };
    require!(amount > 0, BuybackError::ZeroAmount);
    let bump = [ctx.accounts.state.auth_bump];
    let seeds: &[&[&[u8]]] = &[&[BB_AUTH_SEED, &bump]];
    anchor_spl::token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::TransferChecked {
                from: ctx.accounts.source.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.bb_auth.to_account_info(),
            },
            seeds,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    Ok(())
}
