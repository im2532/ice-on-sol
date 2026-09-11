use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::DistError;
use crate::events::Payout;
use crate::state::{DistConfig, Epoch};

/// Borsh-identical to the contract's `(Pubkey, u64)` tuple; a named struct keeps the IDL clean.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PayoutItem {
    pub wallet: Pubkey,
    pub amount: u64,
}

/// `remaining_accounts[i]` = existing COIN token account of `items[i].wallet` (writable). No ATA init:
/// wallets without a COIN account go through the Merkle claim (they pay their own rent).
#[derive(Accounts)]
pub struct PushPayouts<'info> {
    pub keeper: Signer<'info>,

    #[account(seeds = [DIST_SEED], bump = dist_config.bump)]
    pub dist_config: Box<Account<'info, DistConfig>>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, epoch.pool.as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump,
        has_one = coin_mint
    )]
    pub epoch: Box<Account<'info, Epoch>>,

    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = epoch,
        associated_token::token_program = token_program
    )]
    pub epoch_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_push_payouts<'info>(
    ctx: Context<'_, '_, 'info, 'info, PushPayouts<'info>>,
    items: Vec<PayoutItem>,
) -> Result<()> {
    let cfg = &ctx.accounts.dist_config;
    require!(!cfg.paused, DistError::Paused);
    require!(
        cfg.is_admin_or_keeper(ctx.accounts.keeper.key),
        DistError::Unauthorized
    );
    require!(items.len() <= MAX_PUSH_ITEMS, DistError::TooManyItems);
    require!(
        ctx.remaining_accounts.len() == items.len(),
        DistError::AccountsMismatch
    );

    let epoch = &ctx.accounts.epoch;
    require!(!epoch.finalized, DistError::AlreadyFinalized);

    let mut sum: u64 = 0;
    for it in items.iter() {
        require!(it.amount > 0, DistError::ZeroAmount);
        sum = sum
            .checked_add(it.amount)
            .ok_or(error!(DistError::MathOverflow))?;
    }
    let remainder = epoch
        .total_amount
        .checked_sub(epoch.pushed_amount)
        .ok_or(error!(DistError::MathOverflow))?;
    require!(sum <= remainder, DistError::ExceedsRemainder);
    let new_pushed = epoch
        .pushed_amount
        .checked_add(sum)
        .ok_or(error!(DistError::MathOverflow))?;
    let cap = ((epoch.total_amount as u128) * (cfg.max_push_per_epoch_bps as u128)
        / (BPS_DENOM as u128)) as u64;
    require!(new_pushed <= cap, DistError::PushCapExceeded);

    let pool = epoch.pool;
    let index_le = epoch.index.to_le_bytes();
    let epoch_bump = [epoch.bump];
    let epoch_key = epoch.key();
    let coin_mint = epoch.coin_mint;
    let seeds: &[&[&[u8]]] = &[&[EPOCH_SEED, pool.as_ref(), &index_le, &epoch_bump]];

    let token_program_key = ctx.accounts.token_program.key();
    let vault_key = ctx.accounts.epoch_vault.key();
    let decimals = ctx.accounts.coin_mint.decimals;

    for (i, it) in items.iter().enumerate() {
        let dest = &ctx.remaining_accounts[i];
        require!(dest.is_writable, DistError::InvalidDestination);
        require_keys_eq!(
            *dest.owner,
            token_program_key,
            DistError::InvalidDestination
        );
        require_keys_neq!(dest.key(), vault_key, DistError::InvalidDestination);
        {
            let data = dest.try_borrow_data()?;
            let ta = TokenAccount::try_deserialize(&mut &data[..])
                .map_err(|_| error!(DistError::InvalidDestination))?;
            require_keys_eq!(ta.mint, coin_mint, DistError::InvalidDestination);
            require_keys_eq!(ta.owner, it.wallet, DistError::InvalidDestination);
        }

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.epoch_vault.to_account_info(),
                    mint: ctx.accounts.coin_mint.to_account_info(),
                    to: dest.clone(),
                    authority: ctx.accounts.epoch.to_account_info(),
                },
                seeds,
            ),
            it.amount,
            decimals,
        )?;

        emit!(Payout {
            pool,
            epoch: epoch_key,
            wallet: it.wallet,
            coin_mint,
            amount: it.amount,
            kind: PAYOUT_PUSH,
        });
    }

    ctx.accounts.epoch.pushed_amount = new_pushed;
    Ok(())
}
