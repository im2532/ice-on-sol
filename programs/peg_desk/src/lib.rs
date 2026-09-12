//! ICEmarkets Peg Desk — issues commodity coins (GLD, SLV, CL, …) against a USDC reserve.
//!
//! buy:  USDC → reserve vault, mint COIN at `oracle × (1 + spread)`.
//! sell: burn COIN, pay USDC from the reserve at `oracle × (1 − spread)`.
//! The spread stays in the reserve until a keeper sweeps the excess above 102% to treasury.
//!
//! Interface contract: docs/CONTRACTS.md §1. Design notes: programs/peg_desk/README.md.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod oracle;
pub mod pricing;
pub mod state;

pub use instructions::*;
pub use state::IndexLeg;

// Placeholder id (43 chars; the original 44-char "PegDesk1…" decoded to 33 bytes). Anchor.toml,
// .env.example and packages/registry/src/programs.ts use the same value; scripts/write-program-ids.ts
// replaces all of them with the deployed keypair address.
declare_id!("6jMv6pdi3nB4RRmJSojDy2cHRLMgKNM3ZEeJFngWrqQN");

#[program]
pub mod peg_desk {
    use super::*;

    // ---- global config ------------------------------------------------------------------------

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_conf_bps: u16,
        reserve_warn_bps: u16,
        reserve_halt_bps: u16,
    ) -> Result<()> {
        instructions::admin::handle_initialize_config(
            ctx,
            max_conf_bps,
            reserve_warn_bps,
            reserve_halt_bps,
        )
    }

    pub fn set_keepers(ctx: Context<AdminConfig>, keepers: Vec<Pubkey>) -> Result<()> {
        instructions::admin::handle_set_keepers(ctx, keepers)
    }

    pub fn propose_admin(ctx: Context<AdminConfig>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::handle_propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::handle_accept_admin(ctx)
    }

    pub fn set_global_pause(ctx: Context<SetGlobalPause>, paused: bool) -> Result<()> {
        instructions::admin::handle_set_global_pause(ctx, paused)
    }

    // ---- commodities --------------------------------------------------------------------------

    pub fn create_commodity(
        ctx: Context<CreateCommodity>,
        args: CreateCommodityArgs,
    ) -> Result<()> {
        instructions::commodity::handle_create_commodity(ctx, args)
    }

    pub fn set_commodity_params(ctx: Context<UpdateCommodity>, args: SetParamsArgs) -> Result<()> {
        instructions::commodity::handle_set_commodity_params(ctx, args)
    }

    pub fn set_feed_account(
        ctx: Context<UpdateCommodity>,
        feed_account: Pubkey,
        fx_feed_account: Pubkey,
    ) -> Result<()> {
        instructions::commodity::handle_set_feed_account(ctx, feed_account, fx_feed_account)
    }

    pub fn set_status(ctx: Context<UpdateCommodity>, status: u8) -> Result<()> {
        instructions::commodity::handle_set_status(ctx, status)
    }

    /// Admin: reset the price-deviation breaker anchor (`Commodity.last_price = 0`).
    pub fn clear_price_anchor(ctx: Context<UpdateCommodity>) -> Result<()> {
        instructions::commodity::handle_clear_price_anchor(ctx)
    }

    /// remaining_accounts: the leg Commodity accounts, in `legs` order.
    pub fn set_index_legs(ctx: Context<UpdateCommodity>, legs: Vec<IndexLeg>) -> Result<()> {
        instructions::commodity::handle_set_index_legs(ctx, legs)
    }

    // ---- keeper oracle ------------------------------------------------------------------------

    pub fn keeper_update_price(
        ctx: Context<KeeperUpdatePrice>,
        price: u64,
        conf: u64,
        publish_time: i64,
        source_hash: [u8; 32],
    ) -> Result<()> {
        instructions::keeper::handle_keeper_update_price(
            ctx,
            price,
            conf,
            publish_time,
            source_hash,
        )
    }

    /// Addition to CONTRACTS.md: admin sets KeeperPrice.max_move_bps / min_interval.
    pub fn set_keeper_bounds(
        ctx: Context<SetKeeperBounds>,
        max_move_bps: u16,
        min_interval: u32,
    ) -> Result<()> {
        instructions::keeper::handle_set_keeper_bounds(ctx, max_move_bps, min_interval)
    }

    // ---- trading ------------------------------------------------------------------------------

    /// remaining_accounts (Composite only): [leg Commodity, leg price source] × leg_count.
    pub fn buy<'info>(
        ctx: Context<'_, '_, '_, 'info, TradeAccounts<'info>>,
        usdc_in: u64,
        min_coin_out: u64,
    ) -> Result<()> {
        instructions::trade::handle_buy(ctx, usdc_in, min_coin_out)
    }

    pub fn buy_exact_out<'info>(
        ctx: Context<'_, '_, '_, 'info, TradeAccounts<'info>>,
        coin_out: u64,
        max_usdc_in: u64,
    ) -> Result<()> {
        instructions::trade::handle_buy_exact_out(ctx, coin_out, max_usdc_in)
    }

    pub fn sell<'info>(
        ctx: Context<'_, '_, '_, 'info, TradeAccounts<'info>>,
        coin_in: u64,
        min_usdc_out: u64,
    ) -> Result<()> {
        instructions::trade::handle_sell(ctx, coin_in, min_usdc_out)
    }

    // ---- reserve ------------------------------------------------------------------------------

    pub fn sweep_spread_fees(ctx: Context<SweepSpreadFees>, amount: u64) -> Result<()> {
        instructions::trade::handle_sweep_spread_fees(ctx, amount)
    }

    pub fn deposit_reserve(ctx: Context<DepositReserve>, amount: u64) -> Result<()> {
        instructions::trade::handle_deposit_reserve(ctx, amount)
    }

    // TODO(v1.1): rebalance_hedge(amount, direction) — admin/keeper moves USDC ↔ hedge asset
    // (PAXG / XAUt0 for GLD) between reserve_vault and hedge_vault (PDA ["hedge", commodity]) via
    // Jupiter CPI. Out of scope for MVP per CONTRACTS.md; MVP only has deposit_reserve.
}
