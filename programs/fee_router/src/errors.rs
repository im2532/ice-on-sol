use anchor_lang::prelude::*;

#[error_code]
pub enum RouterError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Router is paused")]
    Paused,
    #[msg("Split bps must sum to 10000")]
    InvalidSplit,
    #[msg("Too many keepers (max 8)")]
    TooManyKeepers,
    #[msg("Account is not a valid DBC account")]
    InvalidDbcAccount,
    #[msg("DBC config fee_claimer is not the router PDA")]
    FeeClaimerMismatch,
    #[msg("Quote mint mismatch")]
    QuoteMintMismatch,
    #[msg("Base mint mismatch")]
    BaseMintMismatch,
    #[msg("DBC pool does not belong to the given config")]
    ConfigMismatch,
    #[msg("Invalid commodity account")]
    InvalidCommodity,
    #[msg("DBC pool is not migrated")]
    NotMigrated,
    #[msg("Pool migration not recorded in router")]
    MigrationNotRecorded,
    #[msg("Account is not a valid DAMM v2 account")]
    InvalidDammAccount,
    #[msg("Position NFT account invalid or not owned by router")]
    InvalidPositionNft,
    #[msg("Claim too soon for a non-keeper caller")]
    ClaimTooSoon,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid program id")]
    InvalidProgram,
    #[msg("Caller is not the authorised program signer")]
    InvalidAuthority,
    #[msg("Insufficient vault balance")]
    InsufficientVault,
    #[msg("fee_bps out of range")]
    InvalidFeeBps,
    #[msg("Amount must be > 0")]
    ZeroAmount,
}
