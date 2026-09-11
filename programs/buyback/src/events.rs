use anchor_lang::prelude::*;

#[event]
pub struct Buyback {
    pub coin: Pubkey,
    pub coin_amount: u64,
    pub gld_amount: u64,
    pub ice_burned: u64,
}

#[event]
pub struct BuybackParamsUpdated {
    pub admin: Pubkey,
    pub ice_pool: Pubkey,
    pub reserve_buffer_bps: u16,
    pub max_per_cycle: u64,
    pub keeper_count: u8,
    pub paused: bool,
}
