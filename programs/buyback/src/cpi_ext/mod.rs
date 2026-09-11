//! Hand-built CPIs (named `cpi_ext`: Anchor's `#[program]` generates a crate-root `cpi` module).
//! * fee_router::withdraw_for_buyback — our program, discriminator exact.
//! * cp_amm::swap — Meteora DAMM v2 @ a85c926. VERIFY ORDER vs IDL + discriminator.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

/// sha256("global:withdraw_for_buyback")[..8] — our own fee_router.
pub const WITHDRAW_FOR_BUYBACK_DISCRIMINATOR: [u8; 8] = [106, 56, 170, 217, 151, 43, 6, 139];
/// sha256("global:swap")[..8] — verify against IDL (DAMM v2 `swap(SwapParameters{amount_in, minimum_amount_out})`).
pub const DAMM_SWAP_DISCRIMINATOR: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];

fn meta(info: &AccountInfo, is_writable: bool, is_signer: bool) -> AccountMeta {
    if is_writable {
        AccountMeta::new(*info.key, is_signer)
    } else {
        AccountMeta::new_readonly(*info.key, is_signer)
    }
}

/// Order MUST match `fee_router::WithdrawForBuyback`:
/// bb_authority(signer), config, coin_mint, buyback_vault(mut), destination(mut), token_program.
pub struct WithdrawForBuyback<'info> {
    pub fee_router_program: AccountInfo<'info>,
    pub bb_authority: AccountInfo<'info>,
    pub router_config: AccountInfo<'info>,
    pub coin_mint: AccountInfo<'info>,
    pub buyback_vault: AccountInfo<'info>,
    pub destination: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

pub fn withdraw_for_buyback<'info>(
    a: WithdrawForBuyback<'info>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let accounts = vec![
        meta(&a.bb_authority, false, true),
        meta(&a.router_config, false, false),
        meta(&a.coin_mint, false, false),
        meta(&a.buyback_vault, true, false),
        meta(&a.destination, true, false),
        meta(&a.token_program, false, false),
    ];
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&WITHDRAW_FOR_BUYBACK_DISCRIMINATOR);
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: *a.fee_router_program.key,
        accounts,
        data,
    };
    invoke_signed(
        &ix,
        &[
            a.bb_authority,
            a.router_config,
            a.coin_mint,
            a.buyback_vault,
            a.destination,
            a.token_program,
            a.fee_router_program,
        ],
        signer_seeds,
    )?;
    Ok(())
}

/// DAMM v2 `swap` accounts. VERIFY ORDER vs IDL (SwapCtx):
/// pool_authority, pool(mut), input_token_account(mut), output_token_account(mut), token_a_vault(mut),
/// token_b_vault(mut), token_a_mint, token_b_mint, payer(signer), token_a_program, token_b_program,
/// referral_token_account (Option — pass the program id for None), event_authority, program.
pub struct DammSwap<'info> {
    pub pool_authority: AccountInfo<'info>,
    pub pool: AccountInfo<'info>,
    pub input_token_account: AccountInfo<'info>,
    pub output_token_account: AccountInfo<'info>,
    pub token_a_vault: AccountInfo<'info>,
    pub token_b_vault: AccountInfo<'info>,
    pub token_a_mint: AccountInfo<'info>,
    pub token_b_mint: AccountInfo<'info>,
    pub payer: AccountInfo<'info>,
    pub token_a_program: AccountInfo<'info>,
    pub token_b_program: AccountInfo<'info>,
    pub event_authority: AccountInfo<'info>,
    pub program: AccountInfo<'info>,
}

pub fn damm_swap<'info>(
    a: DammSwap<'info>,
    amount_in: u64,
    minimum_amount_out: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // VERIFY ORDER vs IDL
    let accounts = vec![
        meta(&a.pool_authority, false, false),
        meta(&a.pool, true, false),
        meta(&a.input_token_account, true, false),
        meta(&a.output_token_account, true, false),
        meta(&a.token_a_vault, true, false),
        meta(&a.token_b_vault, true, false),
        meta(&a.token_a_mint, false, false),
        meta(&a.token_b_mint, false, false),
        meta(&a.payer, false, true),
        meta(&a.token_a_program, false, false),
        meta(&a.token_b_program, false, false),
        // referral_token_account: None ⇒ Anchor convention is to pass the callee program id.
        meta(&a.program, false, false),
        meta(&a.event_authority, false, false),
        meta(&a.program, false, false),
    ];
    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&DAMM_SWAP_DISCRIMINATOR);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&minimum_amount_out.to_le_bytes());
    let ix = Instruction {
        program_id: *a.program.key,
        accounts,
        data,
    };
    invoke_signed(
        &ix,
        &[
            a.pool_authority,
            a.pool,
            a.input_token_account,
            a.output_token_account,
            a.token_a_vault,
            a.token_b_vault,
            a.token_a_mint,
            a.token_b_mint,
            a.payer,
            a.token_a_program,
            a.token_b_program,
            a.event_authority,
            a.program,
        ],
        signer_seeds,
    )?;
    Ok(())
}
