use anchor_lang::prelude::*;

/// PDA["buyback"] — program state.
pub const STATE_SEED: &[u8] = b"buyback";
/// PDA["bb_auth"] — signer accepted by fee_router `withdraw_for_buyback`; owns the COIN / USDC / ICE work
/// ATAs, is the peg_desk `sell` user and the swap-route `user`.
pub const BB_AUTH_SEED: &[u8] = b"bb_auth";

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_KEEPERS: usize = 8;
pub const DEFAULT_RESERVE_BUFFER_BPS: u16 = 200;
/// Swap must deliver ≥ 95% of the anchored ICE-per-USDC rate by default.
pub const DEFAULT_MAX_DEVIATION_BPS: u16 = 500;
/// Anchor may move ≤ 2% per cycle by default.
pub const DEFAULT_ANCHOR_MOVE_BPS: u16 = 200;
pub const DEFAULT_MIN_INTERVAL_SECS: u32 = 600;
/// The route must spend at least (1 − this) of the cycle's USDC (audit F-03/F-04).
pub const MIN_SPEND_TOLERANCE_BPS: u64 = 100;
/// Max bytes of forwarded route instruction data (Jupiter route data is well under this).
pub const MAX_ROUTE_DATA_LEN: usize = 1024;
/// One USDC in base units (6 decimals) — the anchor's denominator.
pub const USDC_UNIT: u128 = 1_000_000;

/// Jupiter v6: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 (informational; the admin sets `swap_program`).
pub const JUPITER_V6_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    4, 121, 213, 91, 242, 49, 192, 110, 238, 116, 197, 110, 206, 104, 21, 7, 253, 177, 178, 222, 163,
    244, 142, 81, 2, 177, 205, 162, 86, 188, 19, 143,
]);
