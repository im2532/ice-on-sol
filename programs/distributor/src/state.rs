use anchor_lang::prelude::*;

use crate::constants::MAX_KEEPERS;

/// PDA["dist"]
#[account]
#[derive(InitSpace)]
pub struct DistConfig {
    pub admin: Pubkey,
    pub keepers: [Pubkey; 8],
    pub keeper_count: u8,
    /// fee_router program id (holder vaults + treasury live there).
    pub fee_router: Pubkey,
    /// Max share of an epoch's total that may be pushed (rest must go through the Merkle claim). 10000 = no cap.
    pub max_push_per_epoch_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

impl DistConfig {
    pub fn is_keeper(&self, key: &Pubkey) -> bool {
        let n = (self.keeper_count as usize).min(MAX_KEEPERS);
        self.keepers[..n].iter().any(|k| k == key)
    }

    pub fn is_admin_or_keeper(&self, key: &Pubkey) -> bool {
        *key == self.admin || self.is_keeper(key)
    }
}

/// PDA["epoch", pool, index(u32 LE)] — `pool` is the DBC pool key (same key fee_router uses).
#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub pool: Pubkey,
    pub index: u32,
    pub coin_mint: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub total_amount: u64,
    pub pushed_amount: u64,
    pub merkle_root: [u8; 32],
    pub merkle_total: u64,
    pub claimed_amount: u64,
    pub eligible_holders: u32,
    pub twab_total: u128,
    pub finalized: bool,
    pub bump: u8,
}

/// PDA["claimed", epoch, wallet] — existence = already claimed.
#[account]
#[derive(InitSpace)]
pub struct Claimed {
    pub epoch: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
    pub bump: u8,
}
