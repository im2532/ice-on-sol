use anchor_lang::prelude::*;

use crate::constants::MAX_KEEPERS;

/// PDA["router"]. Also the signing authority: DBC `fee_claimer`, DAMM v2 position-NFT owner,
/// and token authority of buyback_vault[coin], treasury[mint] and the router's receiving ATAs.
#[account]
#[derive(InitSpace)]
pub struct RouterConfig {
    pub admin: Pubkey,
    pub keepers: [Pubkey; 8],
    pub keeper_count: u8,
    pub distributor_program: Pubkey,
    pub buyback_program: Pubkey,
    pub holders_bps: u16,
    pub buyback_bps: u16,
    pub protocol_bps: u16,
    pub paused: bool,
    pub bump: u8,
    /// Carved out of the contract's `_reserved[64]` (layout of all fields above is unchanged):
    /// owner program of `Commodity` accounts, checked by permissionless `register_pool`.
    pub peg_desk_program: Pubkey,
    pub _reserved: [u8; 32],
}

impl RouterConfig {
    pub fn is_keeper(&self, key: &Pubkey) -> bool {
        let n = (self.keeper_count as usize).min(MAX_KEEPERS);
        self.keepers[..n].iter().any(|k| k == key)
    }

    pub fn is_admin_or_keeper(&self, key: &Pubkey) -> bool {
        *key == self.admin || self.is_keeper(key)
    }
}

/// PDA["pool", dbc_pool].
#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub dbc_pool: Pubkey,
    pub dbc_config: Pubkey,
    pub base_mint: Pubkey,
    /// COIN
    pub quote_mint: Pubkey,
    pub commodity: Pubkey,
    pub creator: Pubkey,
    pub fee_bps: u16,
    pub migrated: bool,
    pub damm_pool: Pubkey,
    pub damm_position: Pubkey,
    pub position_nft_mint: Pubkey,
    pub total_claimed: u64,
    pub total_to_holders: u64,
    pub total_to_buyback: u64,
    pub total_to_protocol: u64,
    pub last_claim_ts: i64,
    pub bump: u8,
    pub _reserved: [u8; 64],
}
