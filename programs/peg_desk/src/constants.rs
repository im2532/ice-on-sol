//! Seeds and fixed-point constants. Must match `packages/registry/src/programs.ts` (SEEDS.pegDesk)
//! and docs/CONTRACTS.md §1. This module is dependency-free so `pricing.rs` can be unit-tested alone.

// ---- PDA seeds -------------------------------------------------------------
pub const CONFIG_SEED: &[u8] = b"config";
/// `["cmdty", symbol[12]]` — symbol is ASCII, right-padded with 0u8 to 12 bytes.
pub const COMMODITY_SEED: &[u8] = b"cmdty";
/// `["reserve", commodity]` — USDC token account, authority = commodity PDA.
pub const RESERVE_SEED: &[u8] = b"reserve";
/// `["hedge", commodity]` — reserved for v1.1 `rebalance_hedge`.
pub const HEDGE_SEED: &[u8] = b"hedge";
/// `["kp", commodity]` — KeeperPrice.
pub const KEEPER_PRICE_SEED: &[u8] = b"kp";
/// `["mint_auth"]` — single mint authority for every COIN.
pub const MINT_AUTH_SEED: &[u8] = b"mint_auth";

// ---- fixed point -----------------------------------------------------------
/// Prices are u64 with exponent -8 (1e8 == $1.00).
pub const PRICE_EXPO: i32 = -8;
pub const PRICE_SCALE: u64 = 100_000_000;
pub const COIN_DECIMALS: u8 = 6;
pub const USDC_DECIMALS: u8 = 6;
pub const BPS: u64 = 10_000;

// ---- limits ----------------------------------------------------------------
pub const MAX_KEEPERS: usize = 8;
pub const MAX_LEGS: usize = 5;
pub const SYMBOL_LEN: usize = 12;
/// Hard ceiling on the effective spread so `bid` never goes to zero.
pub const MAX_SPREAD_BPS: u16 = 5_000;

// ---- Commodity.status values (mirror state::Status) -------------------------
pub const STATUS_OPEN: u8 = 0;
pub const STATUS_CLOSED: u8 = 1;
pub const STATUS_HALTED: u8 = 2;

// ---- quote scaling (Commodity.quote_scale) --------------------------------
pub const QUOTE_USD: u8 = 0;
pub const QUOTE_USC: u8 = 1;
pub const QUOTE_EUR: u8 = 2;

// ---- KeeperPrice defaults (set on first write; admin can change via set_keeper_bounds) ----
pub const DEFAULT_MAX_MOVE_BPS: u16 = 500; // ±5% per update (spec §3.1A)
pub const DEFAULT_MIN_INTERVAL: u32 = 0;
/// Keeper-posted publish_time may be at most this far ahead of the validator clock.
pub const MAX_FUTURE_SKEW_SECS: i64 = 10;

// ---- circuit breakers ------------------------------------------------------
/// Length of the rolling mint / redeem window (24 h). Windows are fixed buckets anchored at the
/// first trade after expiry, not sliding — cheap and good enough to bound damage per day.
pub const DAILY_WINDOW_SECS: i64 = 86_400;
/// Upper bound for `Commodity.max_deviation_bps` (100%).
pub const MAX_DEVIATION_BPS: u16 = 10_000;

// ---- metadata limits (Metaplex) --------------------------------------------
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_URI_LEN: usize = 200;
