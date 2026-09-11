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
    /// DAMM v2 ICE/GLD pool.
    pub ice_pool: Pubkey,
    pub reserve_buffer_bps: u16,
    pub max_per_cycle: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(init, payer = admin, space = 8 + BuybackState::INIT_SPACE, seeds = [STATE_SEED], bump)]
    pub state: Box<Account<'info, BuybackState>>,

    /// CHECK: PDA["bb_auth"]; holds no data.
    #[account(seeds = [BB_AUTH_SEED], bump)]
    pub bb_auth: UncheckedAccount<'info>,

    pub ice_mint: Box<InterfaceAccount<'info, Mint>>,
    pub gld_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Work account: GLD pulled from fee_router lands here, then is swapped.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = gld_mint,
        associated_token::authority = bb_auth,
        associated_token::token_program = gld_token_program
    )]
    pub bb_gld: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Work account: ICEmarkets bought lands here, then is burned.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = ice_mint,
        associated_token::authority = bb_auth,
        associated_token::token_program = ice_token_program
    )]
    pub bb_icemarkets: Box<InterfaceAccount<'info, TokenAccount>>,

    pub gld_token_program: Interface<'info, TokenInterface>,
    pub ice_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    require!(
        (args.reserve_buffer_bps as u64) < BPS_DENOM,
        BuybackError::InvalidBps
    );
    let s = &mut ctx.accounts.state;
    s.admin = ctx.accounts.admin.key();
    s.keepers = [Pubkey::default(); 8];
    s.keeper_count = 0;
    s.fee_router = args.fee_router;
    s.ice_mint = ctx.accounts.ice_mint.key();
    s.ice_pool = args.ice_pool;
    s.gld_mint = ctx.accounts.gld_mint.key();
    s.reserve_buffer_bps = args.reserve_buffer_bps;
    s.max_per_cycle = args.max_per_cycle;
    s.paused = false;
    s.total_gld_in = 0;
    s.total_ice_burned = 0;
    s.auth_bump = ctx.bumps.bb_auth;
    s.bump = ctx.bumps.state;
    s._reserved = [0u8; 64];

    emit!(BuybackParamsUpdated {
        admin: s.admin,
        ice_pool: s.ice_pool,
        reserve_buffer_bps: s.reserve_buffer_bps,
        max_per_cycle: s.max_per_cycle,
        keeper_count: 0,
        paused: false,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetParamsArgs {
    pub ice_pool: Option<Pubkey>,
    pub fee_router: Option<Pubkey>,
    pub reserve_buffer_bps: Option<u16>,
    pub max_per_cycle: Option<u64>,
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
    if let Some(v) = args.ice_pool {
        s.ice_pool = v;
    }
    if let Some(v) = args.fee_router {
        s.fee_router = v;
    }
    if let Some(v) = args.reserve_buffer_bps {
        require!((v as u64) < BPS_DENOM, BuybackError::InvalidBps);
        s.reserve_buffer_bps = v;
    }
    if let Some(v) = args.max_per_cycle {
        s.max_per_cycle = v;
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
    emit!(BuybackParamsUpdated {
        admin: s.admin,
        ice_pool: s.ice_pool,
        reserve_buffer_bps: s.reserve_buffer_bps,
        max_per_cycle: s.max_per_cycle,
        keeper_count: s.keeper_count,
        paused: s.paused,
    });
    Ok(())
}
