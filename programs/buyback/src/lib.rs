//! ICEmarkets buyback — see docs/CONTRACTS.md §4 and programs/README-fee-stack.md.
//! MVP: GLD → ICEmarkets (DAMM v2) → burn. Other coins go through peg_desk sell/buy in v1.1.
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

    /// Keeper. `amount` is capped by max_per_cycle and the reserve buffer.
    pub fn convert_and_burn(
        ctx: Context<ConvertAndBurn>,
        amount: u64,
        min_ice_out: u64,
        gld_is_token_a: bool,
    ) -> Result<()> {
        instructions::convert_and_burn::handle_convert_and_burn(
            ctx,
            amount,
            min_ice_out,
            gld_is_token_a,
        )
    }

    pub fn set_params(ctx: Context<SetParams>, args: SetParamsArgs) -> Result<()> {
        instructions::initialize::handle_set_params(ctx, args)
    }
}
