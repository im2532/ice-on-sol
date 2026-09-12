//! Hand-built CPIs (named `cpi_ext`: Anchor's `#[program]` generates a crate-root `cpi` module).
//! * fee_router::withdraw_for_buyback — our program, discriminator exact.
//! * peg_desk::sell — our program, discriminator exact (optional oracle accounts follow Anchor's
//!   convention: pass the peg_desk program id in place of a `None`).
//! * route — an opaque, keeper-built swap instruction (Jupiter v6 on mainnet) forwarded verbatim with
//!   bb_auth as the signing `user`; the caller checks balances before/after.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

/// sha256("global:withdraw_for_buyback")[..8] — our own fee_router.
pub const WITHDRAW_FOR_BUYBACK_DISCRIMINATOR: [u8; 8] = [106, 56, 170, 217, 151, 43, 6, 139];
/// sha256("global:sell")[..8] — our own peg_desk (`sell(coin_in, min_usdc_out)`).
pub const PEG_DESK_SELL_DISCRIMINATOR: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173];

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


/// Order MUST match `peg_desk::TradeAccounts` (instructions/trade.rs):
/// user(signer), config, commodity(mut), coin_mint(mut), mint_auth, reserve_vault(mut), user_usdc(mut),
/// user_coin(mut), price_feed?, fx_feed?, keeper_price?, token_program. Composite coins would also need
/// remaining accounts; the buyback does not support them (the sell simply fails).
pub struct PegDeskSell<'info> {
    pub peg_desk_program: AccountInfo<'info>,
    pub user: AccountInfo<'info>,
    pub config: AccountInfo<'info>,
    pub commodity: AccountInfo<'info>,
    pub coin_mint: AccountInfo<'info>,
    pub mint_auth: AccountInfo<'info>,
    pub reserve_vault: AccountInfo<'info>,
    pub user_usdc: AccountInfo<'info>,
    pub user_coin: AccountInfo<'info>,
    /// Optional accounts: pass the peg_desk program account for `None`.
    pub price_feed: AccountInfo<'info>,
    pub fx_feed: AccountInfo<'info>,
    pub keeper_price: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

pub fn peg_desk_sell<'info>(
    a: PegDeskSell<'info>,
    coin_in: u64,
    min_usdc_out: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let accounts = vec![
        meta(&a.user, false, true),
        meta(&a.config, false, false),
        meta(&a.commodity, true, false),
        meta(&a.coin_mint, true, false),
        meta(&a.mint_auth, false, false),
        meta(&a.reserve_vault, true, false),
        meta(&a.user_usdc, true, false),
        meta(&a.user_coin, true, false),
        meta(&a.price_feed, false, false),
        meta(&a.fx_feed, false, false),
        meta(&a.keeper_price, false, false),
        meta(&a.token_program, false, false),
    ];
    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&PEG_DESK_SELL_DISCRIMINATOR);
    data.extend_from_slice(&coin_in.to_le_bytes());
    data.extend_from_slice(&min_usdc_out.to_le_bytes());
    let ix = Instruction {
        program_id: *a.peg_desk_program.key,
        accounts,
        data,
    };
    invoke_signed(
        &ix,
        &[
            a.user,
            a.config,
            a.commodity,
            a.coin_mint,
            a.mint_auth,
            a.reserve_vault,
            a.user_usdc,
            a.user_coin,
            a.price_feed,
            a.fx_feed,
            a.keeper_price,
            a.token_program,
            a.peg_desk_program,
        ],
        signer_seeds,
    )?;
    Ok(())
}

/// Forwards an opaque swap instruction to `swap_program`. `accounts` are the route's accounts in the
/// order the router expects; every account whose key equals `signer` is marked as a signer (bb_auth,
/// signed via `signer_seeds`), all other signer flags are cleared so the keeper cannot smuggle in a
/// third-party signer. Writability is taken from the passed AccountInfos.
pub fn invoke_route<'info>(
    swap_program: &AccountInfo<'info>,
    accounts: &[AccountInfo<'info>],
    signer: &Pubkey,
    data: &[u8],
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let metas: Vec<AccountMeta> = accounts
        .iter()
        .map(|ai| meta(ai, ai.is_writable, ai.key == signer))
        .collect();
    let ix = Instruction {
        program_id: *swap_program.key,
        accounts: metas,
        data: data.to_vec(),
    };
    let mut infos: Vec<AccountInfo<'info>> = accounts.to_vec();
    infos.push(swap_program.clone());
    invoke_signed(&ix, &infos, signer_seeds)?;
    Ok(())
}
