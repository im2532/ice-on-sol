use anchor_lang::prelude::*;

#[event]
pub struct EpochOpened {
    pub pool: Pubkey,
    pub index: u32,
    pub total: u64,
    pub holders: u32,
}

/// kind: 0 = push, 1 = claim
#[event]
pub struct Payout {
    pub pool: Pubkey,
    pub epoch: Pubkey,
    pub wallet: Pubkey,
    pub coin_mint: Pubkey,
    pub amount: u64,
    pub kind: u8,
}

#[event]
pub struct EpochFinalized {
    pub pool: Pubkey,
    pub index: u32,
    pub merkle_root: [u8; 32],
    pub remainder: u64,
}

#[event]
pub struct EpochSwept {
    pub pool: Pubkey,
    pub index: u32,
    pub amount: u64,
    pub treasury: Pubkey,
}

#[event]
pub struct DistConfigUpdated {
    pub admin: Pubkey,
    pub fee_router: Pubkey,
    pub keeper_count: u8,
    pub max_push_per_epoch_bps: u16,
    pub paused: bool,
}
