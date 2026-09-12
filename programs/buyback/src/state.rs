use anchor_lang::prelude::*;

use crate::constants::MAX_KEEPERS;

/// PDA["buyback"] — v2 layout (CONTRACTS §4a). The v1 (ICE/GLD DAMM) layout was never initialised on
/// devnet or mainnet, so this is a clean replacement rather than a migration.
#[account]
#[derive(InitSpace)]
pub struct BuybackState {
    pub admin: Pubkey,
    pub keepers: [Pubkey; 8],
    pub keeper_count: u8,
    /// Programs the CPIs are allowed to target.
    pub fee_router: Pubkey,
    pub peg_desk: Pubkey,
    /// Swap router (Jupiter v6 on mainnet; any AMM program on localnet — see `route` in convert_and_burn).
    pub swap_program: Pubkey,
    pub ice_mint: Pubkey,
    pub usdc_mint: Pubkey,
    /// Share of a coin's buyback vault left untouched each cycle (dust / rounding). Default 200.
    pub reserve_buffer_bps: u16,
    /// Max USDC (base units) converted per `convert_and_burn` call. 0 = unlimited.
    pub max_per_cycle_usdc: u64,
    /// Min seconds between two cycles (any coin). Bounds how fast a bad keeper can drain the vaults.
    pub min_interval_secs: u32,
    pub last_cycle_ts: i64,
    /// Anchor for the swap-rate breaker: ICE base units received per 1 USDC (1e6 base units) on the
    /// last accepted cycle. 0 = unset (first cycle sets it; admin can set it explicitly).
    pub ice_per_usdc_anchor: u64,
    /// A cycle must deliver ≥ anchor × (1 − max_deviation_bps) ICE per USDC.
    pub max_deviation_bps: u16,
    /// The anchor moves at most this many bps per cycle towards the executed rate (in either direction).
    pub anchor_move_bps: u16,
    pub paused: bool,
    pub total_usdc_out: u64,
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
