use anchor_lang::prelude::*;

#[error_code]
pub enum DistError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Distributor is paused")]
    Paused,
    #[msg("Too many keepers (max 8)")]
    TooManyKeepers,
    #[msg("Invalid epoch window")]
    InvalidWindow,
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Epoch vault not funded with total_amount")]
    FundingMismatch,
    #[msg("Invalid funding source")]
    InvalidSource,
    #[msg("Missing fee_router accounts in remaining_accounts")]
    MissingRouterAccounts,
    #[msg("fee_router program mismatch")]
    InvalidFeeRouter,
    #[msg("Too many payout items (max 12)")]
    TooManyItems,
    #[msg("remaining_accounts must match items 1:1")]
    AccountsMismatch,
    #[msg("Destination must be an existing token account of the wallet for the epoch coin")]
    InvalidDestination,
    #[msg("Payout exceeds epoch remainder")]
    ExceedsRemainder,
    #[msg("Push cap for this epoch exceeded")]
    PushCapExceeded,
    #[msg("Epoch already finalized")]
    AlreadyFinalized,
    #[msg("Epoch not finalized")]
    NotFinalized,
    #[msg("Invalid Merkle proof")]
    InvalidProof,
    #[msg("Proof too long")]
    ProofTooLong,
    #[msg("Claim window closed")]
    ClaimWindowClosed,
    #[msg("Sweep not yet allowed")]
    SweepTooEarly,
    #[msg("Invalid treasury account")]
    InvalidTreasury,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid bps")]
    InvalidBps,
}
