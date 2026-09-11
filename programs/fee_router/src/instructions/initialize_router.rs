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
