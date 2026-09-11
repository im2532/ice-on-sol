//! Hand-built CPI into our own fee_router (keeps crates decoupled; no cross-program `cpi` feature).
//! Named `cpi_ext` because Anchor's `#[program]` generates a crate-root `cpi` module.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

/// sha256("global:withdraw_for_epoch")[..8] — our own program, exact (re-check with scripts/print-discriminators.ts).
pub const WITHDRAW_FOR_EPOCH_DISCRIMINATOR: [u8; 8] = [103, 104, 65, 174, 89, 171, 49, 217];

/// Order MUST match `fee_router::WithdrawForEpoch`:
/// dist_authority(signer), config, pool_state, holder_vault(mut), quote_mint, destination(mut), token_program.
pub struct WithdrawForEpoch<'info> {
    pub fee_router_program: AccountInfo<'info>,
    pub dist_authority: AccountInfo<'info>,
    pub router_config: AccountInfo<'info>,
    pub pool_state: AccountInfo<'info>,
    pub holder_vault: AccountInfo<'info>,
    pub quote_mint: AccountInfo<'info>,
    pub destination: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

pub fn withdraw_for_epoch<'info>(
    a: WithdrawForEpoch<'info>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let accounts = vec![
        AccountMeta::new_readonly(*a.dist_authority.key, true),
        AccountMeta::new_readonly(*a.router_config.key, false),
        AccountMeta::new_readonly(*a.pool_state.key, false),
        AccountMeta::new(*a.holder_vault.key, false),
        AccountMeta::new_readonly(*a.quote_mint.key, false),
        AccountMeta::new(*a.destination.key, false),
        AccountMeta::new_readonly(*a.token_program.key, false),
    ];
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&WITHDRAW_FOR_EPOCH_DISCRIMINATOR);
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: *a.fee_router_program.key,
        accounts,
        data,
    };
    invoke_signed(
        &ix,
        &[
            a.dist_authority,
            a.router_config,
            a.pool_state,
            a.holder_vault,
            a.quote_mint,
            a.destination,
            a.token_program,
            a.fee_router_program,
        ],
        signer_seeds,
    )?;
    Ok(())
}
