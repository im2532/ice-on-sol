use anchor_lang::prelude::*;

// ---- PDA seeds (must match packages/registry/src/programs.ts SEEDS.feeRouter) ----
pub const ROUTER_SEED: &[u8] = b"router";
pub const POOL_SEED: &[u8] = b"pool";
pub const HOLDER_VAULT_SEED: &[u8] = b"holder_vault";
pub const BUYBACK_VAULT_SEED: &[u8] = b"buyback_vault";
pub const TREASURY_SEED: &[u8] = b"treasury";

/// Seed of the distributor program's signer PDA allowed to call `withdraw_for_epoch`.
pub const DIST_AUTH_SEED: &[u8] = b"dist_auth";
/// Seed of the buyback program's signer PDA allowed to call `withdraw_for_buyback`.
pub const BB_AUTH_SEED: &[u8] = b"bb_auth";

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_KEEPERS: usize = 8;
/// Non-keepers may trigger a claim once this many seconds have passed since the last claim.
pub const PERMISSIONLESS_CLAIM_INTERVAL: i64 = 900;
/// Sanity bound for the informational `fee_bps` stored on PoolState (10%).
pub const MAX_FEE_BPS: u16 = 1_000;

// ---- FeesClaimed.source ----
pub const SOURCE_DBC: u8 = 0;
pub const SOURCE_SURPLUS: u8 = 1;
pub const SOURCE_DAMM: u8 = 2;

// ---- VaultWithdrawn.kind ----
pub const WITHDRAW_EPOCH: u8 = 0;
pub const WITHDRAW_BUYBACK: u8 = 1;
pub const WITHDRAW_TREASURY: u8 = 2;

// ---- External programs (byte arrays avoid any `pubkey!` macro-path differences across solana-program versions) ----

/// Meteora Dynamic Bonding Curve: dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
pub const DBC_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    9, 96, 12, 165, 36, 247, 177, 183, 214, 204, 177, 195, 151, 58, 160, 51, 13, 25, 3, 218, 96,
    28, 201, 181, 222, 227, 198, 98, 180, 202, 209, 73,
]);

/// Meteora DAMM v2 (cp-amm): cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
pub const DAMM_V2_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    9, 45, 33, 53, 101, 122, 21, 156, 43, 135, 212, 182, 106, 112, 219, 142, 151, 82, 56, 159, 247,
    106, 175, 32, 108, 237, 6, 58, 56, 249, 90, 237,
]);

/// Raw byte layout of Meteora DBC zero-copy accounts at rev f552f20.
/// All offsets INCLUDE the 8-byte Anchor account discriminator.
/// VERIFY OFFSET: re-derive from `state/config.rs` (PoolConfig) and `state/virtual_pool.rs` (VirtualPool)
/// or by decoding a live account with the SDK (`scripts/print-discriminators.ts` prints the discriminators).
pub mod dbc_layout {
    /// sha256("account:PoolConfig")[..8] — verify against IDL
    pub const POOL_CONFIG_DISCRIMINATOR: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];
    /// sha256("account:VirtualPool")[..8] — verify against IDL
    pub const VIRTUAL_POOL_DISCRIMINATOR: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];

    // PoolConfig { quote_mint: Pubkey, fee_claimer: Pubkey, leftover_receiver: Pubkey, pool_fees, ... }
    pub const CONFIG_QUOTE_MINT_OFFSET: usize = 8; // VERIFY OFFSET
    pub const CONFIG_FEE_CLAIMER_OFFSET: usize = 40; // VERIFY OFFSET
    pub const CONFIG_MIN_LEN: usize = 72;

    // VirtualPool { volatility_tracker: VolatilityTracker (64 B), config, creator, base_mint, base_vault,
    //   quote_vault, base_reserve u64, quote_reserve u64, protocol_base_fee u64, protocol_quote_fee u64,
    //   partner_base_fee u64, partner_quote_fee u64, sqrt_price u128, activation_point u64, pool_type u8,
    //   is_migrated u8, ... }
    pub const POOL_CONFIG_OFFSET: usize = 72; // VERIFY OFFSET
    pub const POOL_CREATOR_OFFSET: usize = 104; // VERIFY OFFSET
    pub const POOL_BASE_MINT_OFFSET: usize = 136; // VERIFY OFFSET
    pub const POOL_IS_MIGRATED_OFFSET: usize = 305; // VERIFY OFFSET
    pub const POOL_MIN_LEN: usize = 306;
}

/// Raw byte layout of Meteora DAMM v2 accounts at rev a85c926 (offsets include the discriminator).
pub mod damm_layout {
    /// sha256("account:Pool")[..8] — verify against IDL
    pub const POOL_DISCRIMINATOR: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];
    /// sha256("account:Position")[..8] — verify against IDL
    pub const POSITION_DISCRIMINATOR: [u8; 8] = [170, 188, 143, 228, 122, 64, 247, 208];
    // Position { pool: Pubkey, nft_mint: Pubkey, ... }
    pub const POSITION_POOL_OFFSET: usize = 8; // VERIFY OFFSET
    pub const POSITION_NFT_MINT_OFFSET: usize = 40; // VERIFY OFFSET
    pub const POSITION_MIN_LEN: usize = 72;
}

/// Layout of our own peg_desk `Commodity` (borsh, see docs/CONTRACTS.md §1): disc(8) + symbol[12] + coin_mint.
pub mod peg_desk_layout {
    pub const COMMODITY_COIN_MINT_OFFSET: usize = 8 + 12;
    pub const COMMODITY_MIN_LEN: usize = COMMODITY_COIN_MINT_OFFSET + 32;
}
