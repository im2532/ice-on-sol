use anchor_lang::prelude::*;

/// PDA["buyback"] — program state.
pub const STATE_SEED: &[u8] = b"buyback";
/// PDA["bb_auth"] — signer accepted by fee_router `withdraw_for_buyback`; owns the GLD/ICE work ATAs
/// and is the DAMM v2 swap `payer`.
pub const BB_AUTH_SEED: &[u8] = b"bb_auth";

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_KEEPERS: usize = 8;
pub const DEFAULT_RESERVE_BUFFER_BPS: u16 = 200;

/// Meteora DAMM v2 (cp-amm): cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
pub const DAMM_V2_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    9, 45, 33, 53, 101, 122, 21, 156, 43, 135, 212, 182, 106, 112, 219, 142, 151, 82, 56, 159, 247,
    106, 175, 32, 108, 237, 6, 58, 56, 249, 90, 237,
]);
