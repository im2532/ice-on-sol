//! ICEmarkets distributor — see docs/CONTRACTS.md §3 and programs/README-fee-stack.md.
//!
//! Per pool, per epoch: keeper opens an epoch (pulling `total_amount` of COIN from fee_router's
//! holder_vault via CPI), pushes payouts to wallets that already hold a COIN account, then posts a
//! Merkle root for the remainder which wallets claim themselves.
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod cpi_ext;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod merkle;
pub mod state;

pub use instructions::*;

declare_id!("Distrib1111111111111111111111111111111111111");

#[program]
pub mod distributor {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        fee_router: Pubkey,
        max_push_per_epoch_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, fee_router, max_push_per_epoch_bps)
    }

    /// Keeper. Router mode: remaining_accounts = [fee_router_program, router_config]. See `OpenEpoch` docs.
    pub fn open_epoch<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenEpoch<'info>>,
        args: OpenEpochArgs,
    ) -> Result<()> {
        instructions::open_epoch::handle_open_epoch(ctx, args)
    }

    /// Keeper. ≤ 12 items; remaining_accounts[i] = existing COIN token account of items[i].wallet.
    pub fn push_payouts<'info>(
        ctx: Context<'_, '_, 'info, 'info, PushPayouts<'info>>,
        items: Vec<PayoutItem>,
    ) -> Result<()> {
        instructions::push_payouts::handle_push_payouts(ctx, items)
    }

    pub fn finalize_epoch(
        ctx: Context<FinalizeEpoch>,
        merkle_root: [u8; 32],
        merkle_total: u64,
    ) -> Result<()> {
        instructions::finalize_epoch::handle_finalize_epoch(ctx, merkle_root, merkle_total)
    }

    /// Wallet. leaf = keccak(epoch || wallet || amount_le); sorted-pair nodes.
    pub fn claim(ctx: Context<Claim>, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        instructions::claim::handle_claim(ctx, amount, proof)
    }

    pub fn sweep_unclaimed(ctx: Context<SweepUnclaimed>) -> Result<()> {
        instructions::sweep_unclaimed::handle_sweep_unclaimed(ctx)
    }

    pub fn set_keepers(ctx: Context<DistAdmin>, keepers: Vec<Pubkey>) -> Result<()> {
        instructions::initialize::handle_set_keepers(ctx, keepers)
    }

    pub fn set_params(
        ctx: Context<DistAdmin>,
        fee_router: Option<Pubkey>,
        max_push_per_epoch_bps: Option<u16>,
        paused: Option<bool>,
        new_admin: Option<Pubkey>,
    ) -> Result<()> {
        instructions::initialize::handle_set_params(
            ctx,
            fee_router,
            max_push_per_epoch_bps,
            paused,
            new_admin,
        )
    }
}
