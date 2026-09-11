// ---- PDA seeds (distributor) ----
pub const DIST_SEED: &[u8] = b"dist";
pub const EPOCH_SEED: &[u8] = b"epoch";
pub const CLAIMED_SEED: &[u8] = b"claimed";
/// Signer PDA the fee_router accepts for `withdraw_for_epoch`.
pub const DIST_AUTH_SEED: &[u8] = b"dist_auth";

// ---- fee_router seeds we derive against (must match programs/fee_router/src/constants.rs) ----
pub const ROUTER_POOL_SEED: &[u8] = b"pool";
pub const ROUTER_TREASURY_SEED: &[u8] = b"treasury";

pub const BPS_DENOM: u64 = 10_000;
pub const MAX_KEEPERS: usize = 8;
/// Max push recipients per tx (64-account lock limit; see docs/research/05-verification.md §9a).
pub const MAX_PUSH_ITEMS: usize = 12;
/// Max Merkle proof depth (2^32 leaves).
pub const MAX_PROOF_LEN: usize = 32;
/// Unclaimed remainder can be swept to treasury this long after `end_ts`; claims close at the same time.
pub const SWEEP_DELAY_SECS: i64 = 180 * 24 * 60 * 60;

// ---- Payout.kind ----
pub const PAYOUT_PUSH: u8 = 0;
pub const PAYOUT_CLAIM: u8 = 1;

/// Merkle leaf domain: leaf = keccak(epoch_pubkey || wallet || amount_le_u64); nodes use sorted-pair
/// keccak(min || max). Leaves are 72 bytes and nodes 64 bytes, so a node can't be passed off as a leaf.
/// Must match tests/merkle.ts.
pub const LEAF_LEN: usize = 32 + 32 + 8;
