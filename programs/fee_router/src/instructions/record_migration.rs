use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::MigrationRecorded;
use crate::instructions::common::read_pubkey;
use crate::state::{PoolState, RouterConfig};

/// Keeper/admin-provided DAMM v2 pool + position, validated against on-chain bytes.
/// Restricted to keeper/admin (CONTRACTS says "anyone"): otherwise an attacker could, right after
/// migration, gift the router an NFT of a junk position and front-run the real record. Admin/keeper may
/// overwrite a record to correct it. `force` (admin only) skips the DBC `is_migrated` byte check.
#[derive(Accounts)]
pub struct RecordMigration<'info> {
    pub authority: Signer<'info>,

    #[account(seeds = [ROUTER_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,

    #[account(
        mut,
        seeds = [POOL_SEED, dbc_pool.key().as_ref()],
        bump = pool_state.bump,
        has_one = dbc_pool
    )]
    pub pool_state: Box<Account<'info, PoolState>>,

    /// CHECK: DBC VirtualPool; owner checked, `is_migrated` read at a documented offset.
    #[account(owner = DBC_PROGRAM_ID @ RouterError::InvalidDbcAccount)]
    pub dbc_pool: UncheckedAccount<'info>,

    /// CHECK: DAMM v2 Pool; owner + discriminator checked.
    #[account(owner = DAMM_V2_PROGRAM_ID @ RouterError::InvalidDammAccount)]
    pub damm_pool: UncheckedAccount<'info>,

    /// CHECK: DAMM v2 Position; owner + discriminator + pool checked.
    #[account(owner = DAMM_V2_PROGRAM_ID @ RouterError::InvalidDammAccount)]
    pub damm_position: UncheckedAccount<'info>,

    /// Token-2022 account holding the position NFT; must be owned by the router PDA.
    #[account(
        constraint = position_nft_account.owner == config.key() @ RouterError::InvalidPositionNft,
        constraint = position_nft_account.amount == 1 @ RouterError::InvalidPositionNft
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn handle_record_migration(ctx: Context<RecordMigration>, force: bool) -> Result<()> {
    let a = &ctx.accounts;
    let signer = a.authority.key();
    require!(
        a.config.is_admin_or_keeper(&signer),
        RouterError::Unauthorized
    );

    if !(force && signer == a.config.admin) {
        let data = a.dbc_pool.try_borrow_data()?;
        require!(
            data.len() >= dbc_layout::POOL_MIN_LEN
                && data[..8] == dbc_layout::VIRTUAL_POOL_DISCRIMINATOR,
            RouterError::InvalidDbcAccount
        );
        require!(
            data[dbc_layout::POOL_IS_MIGRATED_OFFSET] != 0,
            RouterError::NotMigrated
        );
    }

    {
        let data = a.damm_pool.try_borrow_data()?;
        require!(
            data.len() >= 8 && data[..8] == damm_layout::POOL_DISCRIMINATOR,
            RouterError::InvalidDammAccount
        );
    }

    let nft_mint = {
        let data = a.damm_position.try_borrow_data()?;
        require!(
            data.len() >= damm_layout::POSITION_MIN_LEN
                && data[..8] == damm_layout::POSITION_DISCRIMINATOR,
            RouterError::InvalidDammAccount
        );
        let pos_pool = read_pubkey(&data[..], damm_layout::POSITION_POOL_OFFSET)?;
        require_keys_eq!(pos_pool, a.damm_pool.key(), RouterError::InvalidDammAccount);
        read_pubkey(&data[..], damm_layout::POSITION_NFT_MINT_OFFSET)?
    };
    require_keys_eq!(
        a.position_nft_account.mint,
        nft_mint,
        RouterError::InvalidPositionNft
    );

    let damm_pool = a.damm_pool.key();
    let damm_position = a.damm_position.key();
    let ps = &mut ctx.accounts.pool_state;
    ps.migrated = true;
    ps.damm_pool = damm_pool;
    ps.damm_position = damm_position;
    ps.position_nft_mint = nft_mint;

    emit!(MigrationRecorded {
        pool: ps.dbc_pool,
        damm_pool
    });
    Ok(())
}
