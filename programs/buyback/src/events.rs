use anchor_lang::prelude::*;

#[event]
pub struct Buyback {
    pub coin: Pubkey,
    pub coin_amount: u64,
    pub usdc_out: u64,
    pub ice_burned: u64,
    /// ICE base units per 1 USDC on this cycle, and the anchor after it moved.
    pub rate: u64,
    pub anchor: u64,
}

#[event]
pub struct BuybackParamsUpdated {
    pub admin: Pubkey,
    pub swap_program: Pubkey,
    pub reserve_buffer_bps: u16,
    pub max_per_cycle_usdc: u64,
    pub max_deviation_bps: u16,
    pub anchor_move_bps: u16,
    pub min_interval_secs: u32,
    pub ice_per_usdc_anchor: u64,
    pub keeper_count: u8,
    pub paused: bool,
}
