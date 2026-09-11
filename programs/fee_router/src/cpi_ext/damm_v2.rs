//! Meteora DAMM v2 / cp-amm (rev a85c926) manual CPI.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

use super::{build_ix, ix_data, meta};

/// sha256("global:claim_position_fee")[..8] — verify against IDL
pub const CLAIM_POSITION_FEE_DISCRIMINATOR: [u8; 8] = [180, 38, 154, 17, 133, 33, 162, 211];

/// Accounts for `claim_position_fee()` (no args). VERIFY ORDER vs IDL (ClaimPositionFeeCtx).
pub struct ClaimPositionFee<'info> {
    pub pool_authority: AccountInfo<'info>,
    pub pool: AccountInfo<'info>,
    pub position: AccountInfo<'info>,
    pub token_a_account: AccountInfo<'info>,
    pub token_b_account: AccountInfo<'info>,
    pub token_a_vault: AccountInfo<'info>,
    pub token_b_vault: AccountInfo<'info>,
    pub token_a_mint: AccountInfo<'info>,
    pub token_b_mint: AccountInfo<'info>,
    pub position_nft_account: AccountInfo<'info>,
    pub owner: AccountInfo<'info>,
    pub token_a_program: AccountInfo<'info>,
    pub token_b_program: AccountInfo<'info>,
    pub event_authority: AccountInfo<'info>,
    pub program: AccountInfo<'info>,
}

pub fn claim_position_fee<'info>(
    a: ClaimPositionFee<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // VERIFY ORDER vs IDL. `pool` is marked writable defensively (writable-but-unused is harmless;
    // readonly-but-needed-writable would fail with PrivilegeEscalation).
    let metas = vec![
        meta(&a.pool_authority, false, false),
        meta(&a.pool, true, false),
        meta(&a.position, true, false),
        meta(&a.token_a_account, true, false),
        meta(&a.token_b_account, true, false),
        meta(&a.token_a_vault, true, false),
        meta(&a.token_b_vault, true, false),
        meta(&a.token_a_mint, false, false),
        meta(&a.token_b_mint, false, false),
        meta(&a.position_nft_account, false, false),
        meta(&a.owner, false, true),
        meta(&a.token_a_program, false, false),
        meta(&a.token_b_program, false, false),
        meta(&a.event_authority, false, false),
        meta(&a.program, false, false),
    ];
    let ix = build_ix(
        *a.program.key,
        metas,
        ix_data(CLAIM_POSITION_FEE_DISCRIMINATOR, &[]),
    );
    invoke_signed(
        &ix,
        &[
            a.pool_authority,
            a.pool,
            a.position,
            a.token_a_account,
            a.token_b_account,
            a.token_a_vault,
            a.token_b_vault,
            a.token_a_mint,
            a.token_b_mint,
            a.position_nft_account,
            a.owner,
            a.token_a_program,
            a.token_b_program,
            a.event_authority,
            a.program,
        ],
        signer_seeds,
    )?;
    Ok(())
}
