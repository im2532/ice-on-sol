use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::RouterConfigUpdated;
use crate::instructions::initialize_router::check_split;
use crate::state::RouterConfig;

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [ROUTER_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Box<Account<'info, RouterConfig>>,
}

fn emit_updated(cfg: &RouterConfig) {
    emit!(RouterConfigUpdated {
        admin: cfg.admin,
        holders_bps: cfg.holders_bps,
        buyback_bps: cfg.buyback_bps,
        protocol_bps: cfg.protocol_bps,
        keeper_count: cfg.keeper_count,
        paused: cfg.paused,
    });
}

pub fn handle_set_split(
    ctx: Context<AdminOnly>,
    holders_bps: u16,
    buyback_bps: u16,
    protocol_bps: u16,
) -> Result<()> {
    check_split(holders_bps, buyback_bps, protocol_bps)?;
    let cfg = &mut ctx.accounts.config;
    cfg.holders_bps = holders_bps;
    cfg.buyback_bps = buyback_bps;
    cfg.protocol_bps = protocol_bps;
    emit_updated(cfg);
    Ok(())
}

pub fn handle_set_keepers(ctx: Context<AdminOnly>, keepers: Vec<Pubkey>) -> Result<()> {
    require!(keepers.len() <= MAX_KEEPERS, RouterError::TooManyKeepers);
    let cfg = &mut ctx.accounts.config;
    let mut arr = [Pubkey::default(); 8];
    for (i, k) in keepers.iter().enumerate() {
        arr[i] = *k;
    }
    cfg.keepers = arr;
    cfg.keeper_count = keepers.len() as u8;
    emit_updated(cfg);
    Ok(())
}

pub fn handle_pause(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    cfg.paused = paused;
    emit_updated(cfg);
    Ok(())
}

/// Not in CONTRACTS v0.1: program ids are only known after deploy, and `admin` must be rotatable
/// (fee_claimer can never change on DBC configs, so the router must stay governable).
pub fn handle_set_programs(
    ctx: Context<AdminOnly>,
    distributor_program: Pubkey,
    buyback_program: Pubkey,
    peg_desk_program: Pubkey,
    new_admin: Pubkey,
) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    cfg.distributor_program = distributor_program;
    cfg.buyback_program = buyback_program;
    cfg.peg_desk_program = peg_desk_program;
    if new_admin != Pubkey::default() {
        cfg.admin = new_admin;
    }
    emit_updated(cfg);
    Ok(())
}
