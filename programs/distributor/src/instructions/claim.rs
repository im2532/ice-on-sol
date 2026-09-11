use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::DistError;
use crate::events::Payout;
use crate::merkle;
use crate::state::{Claimed, DistConfig, Epoch};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,

    #[account(seeds = [DIST_SEED], bump = dist_config.bump)]
    pub dist_config: Box<Account<'info, DistConfig>>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, epoch.pool.as_ref(), &epoch.index.to_le_bytes()],
        bump = epoch.bump,
        has_one = coin_mint
    )]
    pub epoch: Box<Account<'info, Epoch>>,

    /// Existence of this PDA is the double-claim guard (init fails if it exists).
    #[account(
        init,
        payer = wallet,
        space = 8 + Claimed::INIT_SPACE,
        seeds = [CLAIMED_SEED, epoch.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub claimed: Box<Account<'info, Claimed>>,

    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = epoch,
        associated_token::token_program = token_program
    )]
    pub epoch_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = wallet,
        associated_token::mint = coin_mint,
        associated_token::authority = wallet,
        associated_token::token_program = token_program
    )]
    pub wallet_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim(ctx: Context<Claim>, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.dist_config.paused, DistError::Paused);
    require!(amount > 0, DistError::ZeroAmount);
    require!(proof.len() <= MAX_PROOF_LEN, DistError::ProofTooLong);

    let epoch = &ctx.accounts.epoch;
    require!(epoch.finalized, DistError::NotFinalized);
    require!(
        now <= epoch.end_ts.saturating_add(SWEEP_DELAY_SECS),
        DistError::ClaimWindowClosed
    );

    let epoch_key = epoch.key();
    let wallet_key = ctx.accounts.wallet.key();
    let leaf = merkle::leaf(&epoch_key, &wallet_key, amount);
    require!(
        merkle::verify(&proof, &epoch.merkle_root, leaf),
        DistError::InvalidProof
    );

    let new_claimed = epoch
        .claimed_amount
        .checked_add(amount)
        .ok_or(error!(DistError::MathOverflow))?;
    require!(
        new_claimed <= epoch.merkle_total,
        DistError::ExceedsRemainder
    );

    let pool = epoch.pool;
    let coin_mint = epoch.coin_mint;
    let index_le = epoch.index.to_le_bytes();
    let epoch_bump = [epoch.bump];
    let seeds: &[&[&[u8]]] = &[&[EPOCH_SEED, pool.as_ref(), &index_le, &epoch_bump]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.epoch_vault.to_account_info(),
                mint: ctx.accounts.coin_mint.to_account_info(),
                to: ctx.accounts.wallet_ata.to_account_info(),
                authority: ctx.accounts.epoch.to_account_info(),
            },
            seeds,
        ),
        amount,
        ctx.accounts.coin_mint.decimals,
    )?;

    ctx.accounts.epoch.claimed_amount = new_claimed;

    let claimed_bump = ctx.bumps.claimed;
    let c = &mut ctx.accounts.claimed;
    c.epoch = epoch_key;
    c.wallet = wallet_key;
    c.amount = amount;
    c.bump = claimed_bump;

    emit!(Payout {
        pool,
        epoch: epoch_key,
        wallet: wallet_key,
        coin_mint,
        amount,
        kind: PAYOUT_CLAIM
    });
    Ok(())
}
