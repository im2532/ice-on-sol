use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TransferChecked};

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::FeesSplit;
use crate::state::{PoolState, RouterConfig};

pub fn read_pubkey(data: &[u8], offset: usize) -> Result<Pubkey> {
    let slice = data
        .get(offset..offset + 32)
        .ok_or(error!(RouterError::InvalidDbcAccount))?;
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(slice);
    Ok(Pubkey::new_from_array(bytes))
}

/// Keepers/admin may claim any time; anyone else only after `PERMISSIONLESS_CLAIM_INTERVAL`.
pub fn check_claim_gate(
    config: &RouterConfig,
    caller: &Pubkey,
    last_claim_ts: i64,
    now: i64,
) -> Result<()> {
    if config.is_admin_or_keeper(caller) {
        return Ok(());
    }
    require!(
        now.saturating_sub(last_claim_ts) > PERMISSIONLESS_CLAIM_INTERVAL,
        RouterError::ClaimTooSoon
    );
    Ok(())
}

/// Token accounts + programs the split needs. The router PDA is the authority of `source`.
pub struct SplitCtx<'info> {
    pub router: AccountInfo<'info>,
    pub source: AccountInfo<'info>,
    pub holder_vault: AccountInfo<'info>,
    pub buyback_vault: AccountInfo<'info>,
    pub treasury: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub decimals: u8,
    pub router_bump: u8,
    pub holders_bps: u16,
    pub buyback_bps: u16,
}

fn transfer_from_router<'info>(
    s: &SplitCtx<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let bump = [s.router_bump];
    let seeds: &[&[&[u8]]] = &[&[ROUTER_SEED, &bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            s.token_program.clone(),
            TransferChecked {
                from: s.source.clone(),
                mint: s.mint.clone(),
                to: to.clone(),
                authority: s.router.clone(),
            },
            seeds,
        ),
        amount,
        s.decimals,
    )
}

/// Internal `split`: moves `amount` of quote COIN from the router receiving ATA into
/// holder_vault[pool] / buyback_vault[coin] / treasury[coin]. Rounding dust goes to protocol.
pub fn split<'info>(
    s: SplitCtx<'info>,
    pool_state: &mut PoolState,
    pool_key: Pubkey,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let holders = ((amount as u128) * (s.holders_bps as u128) / (BPS_DENOM as u128)) as u64;
    let buyback = ((amount as u128) * (s.buyback_bps as u128) / (BPS_DENOM as u128)) as u64;
    let protocol = amount
        .checked_sub(holders)
        .and_then(|v| v.checked_sub(buyback))
        .ok_or(error!(RouterError::MathOverflow))?;

    transfer_from_router(&s, &s.holder_vault, holders)?;
    transfer_from_router(&s, &s.buyback_vault, buyback)?;
    transfer_from_router(&s, &s.treasury, protocol)?;

    pool_state.total_claimed = pool_state
        .total_claimed
        .checked_add(amount)
        .ok_or(error!(RouterError::MathOverflow))?;
    pool_state.total_to_holders = pool_state
        .total_to_holders
        .checked_add(holders)
        .ok_or(error!(RouterError::MathOverflow))?;
    pool_state.total_to_buyback = pool_state
        .total_to_buyback
        .checked_add(buyback)
        .ok_or(error!(RouterError::MathOverflow))?;
    pool_state.total_to_protocol = pool_state
        .total_to_protocol
        .checked_add(protocol)
        .ok_or(error!(RouterError::MathOverflow))?;

    emit!(FeesSplit {
        pool: pool_key,
        holders,
        buyback,
        protocol
    });
    Ok(())
}
