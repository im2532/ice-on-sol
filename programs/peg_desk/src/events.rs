use anchor_lang::prelude::*;

// ---- CONTRACTS.md §1 events ------------------------------------------------

#[event]
pub struct CommodityCreated {
    pub commodity: Pubkey,
    pub symbol: [u8; 12],
    pub mint: Pubkey,
}

/// side: 0 = buy, 1 = sell. `price` is the oracle mid (1e8), `spread_bps` the effective spread.
#[event]
pub struct Trade {
    pub commodity: Pubkey,
    pub user: Pubkey,
    pub side: u8,
    pub usdc: u64,
    pub coin: u64,
    pub price: u64,
    pub spread_bps: u16,
}

#[event]
pub struct PriceUpdated {
    pub commodity: Pubkey,
    pub price: u64,
    pub conf: u64,
    pub publish_time: i64,
}

#[event]
pub struct StatusChanged {
    pub commodity: Pubkey,
    pub status: u8,
}

/// ratio_bps is u64 because an over-collateralised reserve can exceed u16::MAX bps.
#[event]
pub struct ReserveAlert {
    pub commodity: Pubkey,
    pub ratio_bps: u64,
}

#[event]
pub struct ParamsUpdated {
    pub commodity: Pubkey,
}

// ---- additions (every mutable ix emits an event) ---------------------------

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub reserve_mint: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct KeepersSet {
    pub keepers: Vec<Pubkey>,
}

#[event]
pub struct AdminProposed {
    pub current: Pubkey,
    pub pending: Pubkey,
}

#[event]
pub struct AdminChanged {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct GlobalPauseSet {
    pub paused: bool,
    pub by: Pubkey,
}

#[event]
pub struct SpreadFeesSwept {
    pub commodity: Pubkey,
    pub amount: u64,
    pub treasury_usdc: Pubkey,
}

#[event]
pub struct ReserveDeposited {
    pub commodity: Pubkey,
    pub from: Pubkey,
    pub amount: u64,
}
