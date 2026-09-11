//! ICEmarkets fee_router — see docs/CONTRACTS.md §2 and programs/README-fee-stack.md.
//!
//! The router PDA (`["router"]`) is the DBC `fee_claimer` of every ICEmarkets launch config and receives the
//! partner DAMM v2 position NFT at migration. It claims fees by CPI (hand-built, see `cpi_ext`) and
//! splits the COIN side holders / buyback / protocol. Keep this program UPGRADEABLE behind Squads +
//! timelock: DBC `fee_claimer` can never be changed, so a frozen router strands all fees.
#![allow(unexpected_cfgs)]
#![allow(clippy::too_many_arguments)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod cpi_ext;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

pub use instructions::*;

declare_id!("FeeRoutr111111111111111111111111111111111111");

#[program]
pub mod fee_router {
    use super::*;

    pub fn initialize_router(
        ctx: Context<InitializeRouter>,
        args: InitializeRouterArgs,
    ) -> Result<()> {
        instructions::initialize_router::handle_initialize_router(ctx, args)
    }

    /// Permissionless: validates `dbc_config.fee_claimer == router PDA` (raw bytes, see constants::dbc_layout).
    pub fn register_pool(ctx: Context<RegisterPool>, fee_bps: u16) -> Result<()> {
        instructions::register_pool::handle_register_pool(ctx, fee_bps)
    }

    /// Admin override of `register_pool` (skips layout checks).
    pub fn register_pool_admin(
        ctx: Context<RegisterPool>,
        fee_bps: u16,
        creator: Pubkey,
    ) -> Result<()> {
        instructions::register_pool::handle_register_pool_admin(ctx, fee_bps, creator)
    }

    /// CPI `dynamic_bonding_curve::claim_trading_fee(0, u64::MAX)` then split.
    pub fn claim_dbc(ctx: Context<ClaimDbc>) -> Result<()> {
        instructions::claim_dbc::handle_claim_dbc(ctx)
    }

    /// CPI `dynamic_bonding_curve::partner_withdraw_surplus` then split. Keeper only.
    pub fn claim_dbc_surplus(ctx: Context<ClaimDbcSurplus>) -> Result<()> {
        instructions::claim_dbc_surplus::handle_claim_dbc_surplus(ctx)
    }

    /// Keeper/admin: store damm_pool + position after `migrate_damm_v2`.
    pub fn record_migration(ctx: Context<RecordMigration>, force: bool) -> Result<()> {
        instructions::record_migration::handle_record_migration(ctx, force)
    }

    /// CPI `cp_amm::claim_position_fee`; quote split, base → treasury[base_mint] (MVP).
    pub fn claim_damm(ctx: Context<ClaimDamm>) -> Result<()> {
        instructions::claim_damm::handle_claim_damm(ctx)
    }

    /// CPI-only from the distributor (signer = distributor PDA["dist_auth"]).
    pub fn withdraw_for_epoch(ctx: Context<WithdrawForEpoch>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw_for_epoch(ctx, amount)
    }

    /// CPI-only from the buyback program (signer = buyback PDA["bb_auth"]).
    pub fn withdraw_for_buyback(ctx: Context<WithdrawForBuyback>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw_for_buyback(ctx, amount)
    }

    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw_treasury(ctx, amount)
    }

    pub fn set_split(
        ctx: Context<AdminOnly>,
        holders_bps: u16,
        buyback_bps: u16,
        protocol_bps: u16,
    ) -> Result<()> {
        instructions::admin::handle_set_split(ctx, holders_bps, buyback_bps, protocol_bps)
    }

    pub fn set_keepers(ctx: Context<AdminOnly>, keepers: Vec<Pubkey>) -> Result<()> {
        instructions::admin::handle_set_keepers(ctx, keepers)
    }

    pub fn pause(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::handle_pause(ctx, paused)
    }

    pub fn set_programs(
        ctx: Context<AdminOnly>,
        distributor_program: Pubkey,
        buyback_program: Pubkey,
        peg_desk_program: Pubkey,
        new_admin: Pubkey,
    ) -> Result<()> {
        instructions::admin::handle_set_programs(
            ctx,
            distributor_program,
            buyback_program,
            peg_desk_program,
            new_admin,
        )
    }
}
