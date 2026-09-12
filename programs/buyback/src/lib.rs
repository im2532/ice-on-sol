//! ICEmarkets buyback — see docs/CONTRACTS.md §4 and programs/README-fee-stack.md.
//! v2: any COIN → USDC (peg_desk sell) → $ICE (Jupiter route, forwarded) → burn, in one instruction.
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod cpi_ext;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

pub use instructions::*;

declare_id!("2jsn1m1EnUx2AixWn8KSvWa7bqgQJrLqr2pQenzok4Lk");

#[program]
pub mod buyback {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, args)
    }

    /// Keeper. COIN → USDC (peg_desk sell CPI) → ICE (forwarded swap route CPI, `remaining_accounts` =
    /// the route's accounts) → burn. `coin_amount` is capped by the vault buffer; `usdc_out` by
    /// `max_per_cycle_usdc`; the executed ICE/USDC rate by the anchored breaker (CONTRACTS §4a).
    pub fn convert_and_burn<'info>(
        ctx: Context<'_, '_, '_, 'info, ConvertAndBurn<'info>>,
        coin_amount: u64,
        min_usdc_out: u64,
        min_ice_out: u64,
        route_data: Vec<u8>,
    ) -> Result<()> {
        instructions::convert_and_burn::handle_convert_and_burn(
            ctx,
            coin_amount,
            min_usdc_out,
            min_ice_out,
            route_data,
        )
    }

    pub fn set_params(ctx: Context<SetParams>, args: SetParamsArgs) -> Result<()> {
        instructions::initialize::handle_set_params(ctx, args)
    }
}
