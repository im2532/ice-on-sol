use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::cpi_ext;
use crate::errors::DistError;
use crate::events::EpochOpened;
use crate::state::{DistConfig, Epoch};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenEpochArgs {
    /// DBC pool key (fee_router PoolState seed).
    pub pool: Pubkey,
    pub index: u32,
    pub start_ts: i64,
    pub end_ts: i64,
    pub total_amount: u64,
    pub eligible_holders: u32,
    pub twab_total: u128,
}

/// Funding is generic over `source_vault` / `source_authority`:
///
/// * **Router mode (prod):** `source_vault` = fee_router `holder_vault[pool]`, `source_authority` =
///   fee_router `PoolState[pool]` (not a signer). `remaining_accounts = [fee_router_program, router_config]`.
///   The distributor CPIs `fee_router::withdraw_for_epoch(total_amount)` signed by PDA["dist_auth"].
/// * **Direct mode (tests / manual top-ups):** `source_authority` signs this tx and owns `source_vault`;
///   a plain SPL transfer is used. Only keepers can open epochs, so this adds no new trust.
#[derive(Accounts)]
#[instruction(args: OpenEpochArgs)]
pub struct OpenEpoch<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(seeds = [DIST_SEED], bump = dist_config.bump)]
    pub dist_config: Box<Account<'info, DistConfig>>,

    #[account(
        init,
        payer = keeper,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [EPOCH_SEED, args.pool.as_ref(), &args.index.to_le_bytes()],
        bump
    )]
    pub epoch: Box<Account<'info, Epoch>>,

    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,

    /// COIN ATA owned by the Epoch PDA. `init_if_needed`: the ATA address is derivable before the
    /// epoch exists, so anyone could pre-create it (plain `init` would then fail = DoS on this index).
    /// Funding is checked as a balance delta in the handler, so pre-seeded tokens can't break it either.
    #[account(
        init_if_needed,
        payer = keeper,
        associated_token::mint = coin_mint,
        associated_token::authority = epoch,
        associated_token::token_program = token_program
    )]
    pub epoch_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = coin_mint)]
    pub source_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: either a signer owning `source_vault` (direct mode) or fee_router PoolState (router mode).
    pub source_authority: UncheckedAccount<'info>,

    /// CHECK: PDA["dist_auth"] — signer seed for the fee_router CPI; holds no data.
    #[account(seeds = [DIST_AUTH_SEED], bump)]
    pub dist_auth: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_epoch<'info>(
    ctx: Context<'_, '_, 'info, 'info, OpenEpoch<'info>>,
    args: OpenEpochArgs,
) -> Result<()> {
    let cfg = &ctx.accounts.dist_config;
    require!(!cfg.paused, DistError::Paused);
    require!(
        cfg.is_admin_or_keeper(ctx.accounts.keeper.key),
        DistError::Unauthorized
    );
    require!(args.end_ts > args.start_ts, DistError::InvalidWindow);
    // Audit L-03: the claim/sweep clocks key off end_ts, so it must be a real, recent time —
    // not in the future, and not so far in the past that the 180-day claim window is already shut.
    let now = Clock::get()?.unix_timestamp;
    require!(
        args.end_ts <= now && args.end_ts >= now.saturating_sub(MAX_EPOCH_AGE_SECS),
        DistError::InvalidWindow
    );
    require!(args.total_amount > 0, DistError::ZeroAmount);

    let vault_before = ctx.accounts.epoch_vault.amount;
    let source_authority = ctx.accounts.source_authority.to_account_info();
    let direct =
        source_authority.is_signer && ctx.accounts.source_vault.owner == source_authority.key();

    if direct {
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source_vault.to_account_info(),
                    mint: ctx.accounts.coin_mint.to_account_info(),
                    to: ctx.accounts.epoch_vault.to_account_info(),
                    authority: source_authority,
                },
            ),
            args.total_amount,
            ctx.accounts.coin_mint.decimals,
        )?;
    } else {
        require!(
            ctx.remaining_accounts.len() >= 2,
            DistError::MissingRouterAccounts
        );
        let fee_router_program = ctx.remaining_accounts[0].clone();
        let router_config = ctx.remaining_accounts[1].clone();
        require_keys_eq!(
            *fee_router_program.key,
            cfg.fee_router,
            DistError::InvalidFeeRouter
        );
        require!(fee_router_program.executable, DistError::InvalidFeeRouter);
        // source_authority must be fee_router PoolState[args.pool] — ties the pulled vault to this epoch's pool.
        let (expected_pool_state, _) =
            Pubkey::find_program_address(&[ROUTER_POOL_SEED, args.pool.as_ref()], &cfg.fee_router);
        require_keys_eq!(
            source_authority.key(),
            expected_pool_state,
            DistError::InvalidSource
        );
        require_keys_eq!(
            ctx.accounts.source_vault.owner,
            expected_pool_state,
            DistError::InvalidSource
        );

        let bump = [ctx.bumps.dist_auth];
        let seeds: &[&[&[u8]]] = &[&[DIST_AUTH_SEED, &bump]];
        cpi_ext::withdraw_for_epoch(
            cpi_ext::WithdrawForEpoch {
                fee_router_program,
                dist_authority: ctx.accounts.dist_auth.to_account_info(),
                router_config,
                pool_state: source_authority,
                holder_vault: ctx.accounts.source_vault.to_account_info(),
                quote_mint: ctx.accounts.coin_mint.to_account_info(),
                destination: ctx.accounts.epoch_vault.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            args.total_amount,
            seeds,
        )?;
    }

    ctx.accounts.epoch_vault.reload()?;
    require!(
        ctx.accounts.epoch_vault.amount.saturating_sub(vault_before) == args.total_amount,
        DistError::FundingMismatch
    );

    let coin_mint = ctx.accounts.coin_mint.key();
    let bump = ctx.bumps.epoch;
    let e = &mut ctx.accounts.epoch;
    e.pool = args.pool;
    e.index = args.index;
    e.coin_mint = coin_mint;
    e.start_ts = args.start_ts;
    e.end_ts = args.end_ts;
    e.total_amount = args.total_amount;
    e.pushed_amount = 0;
    e.merkle_root = [0u8; 32];
    e.merkle_total = 0;
    e.claimed_amount = 0;
    e.eligible_holders = args.eligible_holders;
    e.twab_total = args.twab_total;
    e.finalized = false;
    e.bump = bump;

    emit!(EpochOpened {
        pool: args.pool,
        index: args.index,
        total: args.total_amount,
        holders: args.eligible_holders,
    });
    Ok(())
}
