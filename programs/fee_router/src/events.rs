use anchor_lang::prelude::*;

#[event]
pub struct RouterInitialized {
    pub admin: Pubkey,
    pub distributor_program: Pubkey,
    pub buyback_program: Pubkey,
    pub holders_bps: u16,
    pub buyback_bps: u16,
    pub protocol_bps: u16,
}

#[event]
pub struct PoolRegistered {
    pub pool: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub commodity: Pubkey,
    pub fee_bps: u16,
}

/// source: 0 = DBC trading fee, 1 = DBC surplus, 2 = DAMM v2 position fee
#[event]
pub struct FeesClaimed {
    pub pool: Pubkey,
    pub source: u8,
    pub quote_amount: u64,
    pub base_amount: u64,
}

#[event]
pub struct FeesSplit {
    pub pool: Pubkey,
    pub holders: u64,
    pub buyback: u64,
    pub protocol: u64,
}

#[event]
pub struct MigrationRecorded {
    pub pool: Pubkey,
    pub damm_pool: Pubkey,
}

/// kind: 0 = epoch (distributor), 1 = buyback, 2 = treasury (admin)
#[event]
pub struct VaultWithdrawn {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub kind: u8,
}

#[event]
pub struct RouterConfigUpdated {
    pub admin: Pubkey,
    pub holders_bps: u16,
    pub buyback_bps: u16,
    pub protocol_bps: u16,
    pub keeper_count: u8,
    pub paused: bool,
}
