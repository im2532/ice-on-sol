use anchor_lang::prelude::*;

use crate::constants::MAX_KEEPERS;

/// PDA["buyback"]
#[account]
#[derive(InitSpace)]
pub struct BuybackState {
    pub admin: Pubkey,
    pub keepers: [Pubkey; 8],
    pub keeper_count: u8,
    pub fee_router: Pubkey,
    pub ice_mint: Pubkey,
    /// DAMM v2 ICE/GLD pool.
    pub ice_pool: Pubkey,
    pub gld_mint: Pubkey,
    /// Share of buyback_vault[GLD] left untouched each cycle (dust / rounding / fee buffer). Default 200.
    pub reserve_buffer_bps: u16,
    /// Max GLD (base units) converted per `convert_and_burn` call.
    pub max_per_cycle: u64,
    pub paused: bool,
    pub total_gld_in: u64,
    pub total_ice_burned: u64,
    pub auth_bump: u8,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl BuybackState {
    pub fn is_admin_or_keeper(&self, key: &Pubkey) -> bool {
        let n = (self.keeper_count as usize).min(MAX_KEEPERS);
        *key == self.admin || self.keepers[..n].iter().any(|k| k == key)
    }
}
