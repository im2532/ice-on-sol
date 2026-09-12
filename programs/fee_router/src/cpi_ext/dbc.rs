//! Meteora Dynamic Bonding Curve (rev f552f20) manual CPI.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

use super::{build_ix, ix_data, meta};

/// sha256("global:claim_trading_fee")[..8] — verify against IDL
pub const CLAIM_TRADING_FEE_DISCRIMINATOR: [u8; 8] = [8, 236, 89, 49, 152, 125, 177, 81];
/// sha256("global:partner_withdraw_surplus")[..8] — verify against IDL
pub const PARTNER_WITHDRAW_SURPLUS_DISCRIMINATOR: [u8; 8] = [168, 173, 72, 100, 201, 98, 38, 92];
/// sha256("global:migration_damm_v2")[..8] — the DBC instruction is named `migration_damm_v2`
/// (IDL 0.2.1), not `migrate_damm_v2`; the previous value here was derived from the wrong name.
/// NOT CPI'd (the keeper sends it top-level via the Meteora SDK); kept as a reference and pinned
/// by packages/sdk/src/meteoraLayout.test.ts.
pub const MIGRATION_DAMM_V2_DISCRIMINATOR: [u8; 8] = [156, 169, 230, 103, 53, 228, 80, 64];

/// Accounts for `claim_trading_fee(max_base_amount: u64, max_quote_amount: u64)`.
/// VERIFY ORDER vs IDL (ClaimTradingFeesCtx).
pub struct ClaimTradingFee<'info> {
    pub pool_authority: AccountInfo<'info>,
    pub config: AccountInfo<'info>,
    pub pool: AccountInfo<'info>,
    pub token_a_account: AccountInfo<'info>,
    pub token_b_account: AccountInfo<'info>,
    pub base_vault: AccountInfo<'info>,
    pub quote_vault: AccountInfo<'info>,
    pub base_mint: AccountInfo<'info>,
    pub quote_mint: AccountInfo<'info>,
    pub fee_claimer: AccountInfo<'info>,
    pub token_base_program: AccountInfo<'info>,
    pub token_quote_program: AccountInfo<'info>,
    pub event_authority: AccountInfo<'info>,
    pub program: AccountInfo<'info>,
}

pub fn claim_trading_fee<'info>(
    a: ClaimTradingFee<'info>,
    max_base_amount: u64,
    max_quote_amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // VERIFY ORDER vs IDL
    let metas = vec![
        meta(&a.pool_authority, false, false),
        meta(&a.config, false, false),
        meta(&a.pool, true, false),
        meta(&a.token_a_account, true, false),
        meta(&a.token_b_account, true, false),
        meta(&a.base_vault, true, false),
        meta(&a.quote_vault, true, false),
        meta(&a.base_mint, false, false),
        meta(&a.quote_mint, false, false),
        meta(&a.fee_claimer, false, true),
        meta(&a.token_base_program, false, false),
        meta(&a.token_quote_program, false, false),
        meta(&a.event_authority, false, false),
        meta(&a.program, false, false),
    ];
    let mut args = Vec::with_capacity(16);
    args.extend_from_slice(&max_base_amount.to_le_bytes());
    args.extend_from_slice(&max_quote_amount.to_le_bytes());
    let ix = build_ix(
        *a.program.key,
        metas,
        ix_data(CLAIM_TRADING_FEE_DISCRIMINATOR, &args),
    );
    invoke_signed(
        &ix,
        &[
            a.pool_authority,
            a.config,
            a.pool,
            a.token_a_account,
            a.token_b_account,
            a.base_vault,
            a.quote_vault,
            a.base_mint,
            a.quote_mint,
            a.fee_claimer,
            a.token_base_program,
            a.token_quote_program,
            a.event_authority,
            a.program,
        ],
        signer_seeds,
    )?;
    Ok(())
}

/// Accounts for `partner_withdraw_surplus()` (no args).
/// VERIFY ORDER vs IDL (PartnerWithdrawSurplusCtx).
pub struct PartnerWithdrawSurplus<'info> {
    pub pool_authority: AccountInfo<'info>,
    pub config: AccountInfo<'info>,
    pub virtual_pool: AccountInfo<'info>,
    pub token_quote_account: AccountInfo<'info>,
    pub quote_vault: AccountInfo<'info>,
    pub quote_mint: AccountInfo<'info>,
    pub fee_claimer: AccountInfo<'info>,
    pub token_quote_program: AccountInfo<'info>,
    pub event_authority: AccountInfo<'info>,
    pub program: AccountInfo<'info>,
}

pub fn partner_withdraw_surplus<'info>(
    a: PartnerWithdrawSurplus<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // VERIFY ORDER vs IDL
    let metas = vec![
        meta(&a.pool_authority, false, false),
        meta(&a.config, false, false),
        meta(&a.virtual_pool, true, false),
        meta(&a.token_quote_account, true, false),
        meta(&a.quote_vault, true, false),
        meta(&a.quote_mint, false, false),
        meta(&a.fee_claimer, false, true),
        meta(&a.token_quote_program, false, false),
        meta(&a.event_authority, false, false),
        meta(&a.program, false, false),
    ];
    let ix = build_ix(
        *a.program.key,
        metas,
        ix_data(PARTNER_WITHDRAW_SURPLUS_DISCRIMINATOR, &[]),
    );
    invoke_signed(
        &ix,
        &[
            a.pool_authority,
            a.config,
            a.virtual_pool,
            a.token_quote_account,
            a.quote_vault,
            a.quote_mint,
            a.fee_claimer,
            a.token_quote_program,
            a.event_authority,
            a.program,
        ],
        signer_seeds,
    )?;
    Ok(())
}
