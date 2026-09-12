use anchor_lang::prelude::*;

use crate::constants::*;

/// PDA `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub keepers: [Pubkey; 8],
    pub keeper_count: u8,
    /// Owner of the USDC token account that receives swept spread fees.
    pub treasury: Pubkey,
    /// USDC mint.
    pub reserve_mint: Pubkey,
    pub global_pause: bool,
    /// Reject oracle if conf / price > this (default 200).
    pub max_conf_bps: u16,
    /// Default 10_200: below this spreads double and sweeps are refused.
    pub reserve_warn_bps: u16,
    /// Default 9_800: buys revert if the post-trade ratio is below this.
    pub reserve_halt_bps: u16,
    pub bump: u8,
    /// Carved from `_reserved` (byte-compatible; default = Pubkey::default() = nobody): a `sell`
    /// signer exempt from `Commodity.daily_redeem_cap` — the buyback program's `bb_auth` PDA, whose
    /// volume is already bounded by `BuybackState.max_per_cycle_usdc`.
    pub redeem_cap_exempt: Pubkey,
    pub _reserved: [u8; 32],
}

impl GlobalConfig {
    pub fn is_admin(&self, key: &Pubkey) -> bool {
        self.admin == *key
    }

    pub fn is_keeper(&self, key: &Pubkey) -> bool {
        let n = (self.keeper_count as usize).min(MAX_KEEPERS);
        self.keepers[..n].iter().any(|k| k == key)
    }

    pub fn is_admin_or_keeper(&self, key: &Pubkey) -> bool {
        self.is_admin(key) || self.is_keeper(key)
    }
}

/// Discriminants mirror `OracleKind` in packages/registry/src/types.ts.
/// Not Borsh-derived on purpose: stored as raw `u8` in accounts/args (borsh 1.x would demand
/// `#[borsh(use_discriminant)]` for explicit discriminants).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum OracleKind {
    PythPull = 0,
    Switchboard = 1,
    KeeperSigned = 2,
    Composite = 3,
}

impl OracleKind {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::PythPull),
            1 => Some(Self::Switchboard),
            2 => Some(Self::KeeperSigned),
            3 => Some(Self::Composite),
            _ => None,
        }
    }
}

/// Discriminants mirror `SessionKind` in packages/registry/src/types.ts.
/// Informational on-chain: the keeper flips `status` by calendar.
/// Not Borsh-derived on purpose: stored as raw `u8` in accounts/args (borsh 1.x would demand
/// `#[borsh(use_discriminant)]` for explicit discriminants).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum SessionKind {
    Continuous = 0,
    CmeGlobex = 1,
    IceUs = 2,
    Lme = 3,
    Slow = 4,
}

impl SessionKind {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Continuous),
            1 => Some(Self::CmeGlobex),
            2 => Some(Self::IceUs),
            3 => Some(Self::Lme),
            4 => Some(Self::Slow),
            _ => None,
        }
    }
}

/// `Closed` = sell-only at `closed_spread_bps`.
/// Not Borsh-derived on purpose: stored as raw `u8` in accounts/args (borsh 1.x would demand
/// `#[borsh(use_discriminant)]` for explicit discriminants).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Status {
    Open = 0,
    Closed = 1,
    Halted = 2,
}

impl Status {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Open),
            1 => Some(Self::Closed),
            2 => Some(Self::Halted),
            _ => None,
        }
    }
}

/// One leg of a Composite (index) coin.
///
/// CONTRACTS.md declares this `#[zero_copy]`; it is Borsh here because it lives inside a Borsh
/// `#[account]`. The byte layout is identical (32 + 2 + 6 = 40 bytes, no padding).
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug, InitSpace,
)]
pub struct IndexLeg {
    pub commodity: Pubkey,
    pub weight_bps: u16,
    pub _pad: [u8; 6],
}

/// PDA `["cmdty", symbol[12]]`.
#[account]
#[derive(InitSpace)]
pub struct Commodity {
    pub symbol: [u8; 12],
    pub coin_mint: Pubkey,
    /// Always COIN_DECIMALS (6).
    pub decimals: u8,
    pub oracle_kind: u8,
    pub session_kind: u8,
    pub status: u8,
    /// Pyth feed id (or Switchboard feed pubkey bytes).
    pub feed_id: [u8; 32],
    /// PythPull: PriceUpdateV2 account posted by keeper; Switchboard: quote account.
    pub feed_account: Pubkey,
    pub fx_feed_id: [u8; 32],
    pub fx_feed_account: Pubkey,
    /// 0 = USD, 1 = US cents (÷100), 2 = EUR (× fx).
    pub quote_scale: u8,
    pub base_spread_bps: u16,
    pub closed_spread_bps: u16,
    pub conf_mult_bps: u16,
    pub max_age_open: u32,
    pub max_age_closed: u32,
    /// Coin base units.
    pub supply_cap: u64,
    /// Coin base units.
    pub per_tx_cap: u64,
    /// Last accepted oracle publish time (monotonic guard).
    pub last_publish_time: i64,
    pub last_price: u64,
    pub reserve_vault: Pubkey,
    pub hedge_vault: Pubkey,
    pub reserve_balance_cached: u64,
    pub legs: [IndexLeg; 5],
    pub leg_count: u8,
    pub bump: u8,
    /// Carved from CONTRACTS.md `_reserved[64]` (byte-compatible): minimum Wormhole signatures
    /// accepted on a partially-verified Pyth update. 0 = require `VerificationLevel::Full`.
    pub pyth_min_signatures: u8,

    // ---- circuit breakers (carved from `_reserved`; all-zero == disabled, so accounts created
    //      before this field set existed keep working unchanged) ----------------------------
    /// Max COIN minted per rolling `DAILY_WINDOW_SECS` window (base units). 0 = no cap.
    pub daily_mint_cap: u64,
    /// Max USDC paid out by `sell` per window (base units). 0 = no cap.
    pub daily_redeem_cap: u64,
    /// Start of the current window (unix). Rolled forward lazily by trades.
    pub window_start: i64,
    pub window_minted: u64,
    pub window_redeemed: u64,
    /// Max |oracle − last_price| / last_price in bps accepted by a trade while the previous
    /// trade's oracle read is younger than `deviation_window_secs`. 0 = disabled.
    /// Applies to every oracle kind (KeeperPrice.max_move_bps only bounds keeper posts).
    pub max_deviation_bps: u16,
    /// Length of one deviation window (secs). The anchor is fixed for a window; the allowed move
    /// grows by `max_deviation_bps` per elapsed window (audit F-06).
    pub deviation_window_secs: u32,
    /// Deviation anchor (1e8) and the validator time it was set. 0 = unanchored (first trade or
    /// admin `clear_price_anchor` sets it). Distinct from `last_price` (the last trade's price).
    pub anchor_price: u64,
    pub anchor_ts: i64,
    pub _reserved: [u8; 1],
}

impl Commodity {
    pub fn status_enum(&self) -> Option<Status> {
        Status::from_u8(self.status)
    }

    pub fn oracle_kind_enum(&self) -> Option<OracleKind> {
        OracleKind::from_u8(self.oracle_kind)
    }

    /// Max oracle age for the current status. Halted markets never trade, but composite legs may
    /// still be read, so Halted falls back to the (longer) closed age; callers reject Halted first.
    pub fn max_age(&self) -> u32 {
        if self.status == Status::Open as u8 {
            self.max_age_open
        } else {
            self.max_age_closed
        }
    }

    pub fn active_legs(&self) -> &[IndexLeg] {
        let n = (self.leg_count as usize).min(MAX_LEGS);
        &self.legs[..n]
    }
}

/// PDA `["kp", commodity]`. Prices here are already USD at 1e8 (quote_scale is not applied).
#[account]
#[derive(InitSpace)]
pub struct KeeperPrice {
    pub commodity: Pubkey,
    pub price: u64,
    pub conf: u64,
    pub publish_time: i64,
    pub source_hash: [u8; 32],
    pub max_move_bps: u16,
    pub min_interval: u32,
    pub bump: u8,
    /// Validator clock at the last accepted post (audit F-05): `min_interval` and `max_move_bps`
    /// are enforced per second of *chain* time, not per keeper-supplied `publish_time`.
    pub last_update_ts: i64,
}

/// Validates a 12-byte, zero-right-padded, uppercase ASCII symbol (A-Z, 0-9).
pub fn validate_symbol(symbol: &[u8; SYMBOL_LEN]) -> bool {
    let len = symbol.iter().position(|b| *b == 0).unwrap_or(SYMBOL_LEN);
    if len == 0 {
        return false;
    }
    let body_ok = symbol[..len]
        .iter()
        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    let pad_ok = symbol[len..].iter().all(|b| *b == 0);
    body_ok && pad_ok
}

/// The symbol without its zero padding, as a String (for Metaplex metadata).
pub fn symbol_string(symbol: &[u8; SYMBOL_LEN]) -> String {
    let len = symbol.iter().position(|b| *b == 0).unwrap_or(SYMBOL_LEN);
    String::from_utf8_lossy(&symbol[..len]).into_owned()
}
