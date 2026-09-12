use anchor_lang::prelude::*;

/// Order of the first 19 variants follows docs/CONTRACTS.md §1 so codes are stable
/// (6000 = Paused … 6018 = InvalidSymbol). New variants go at the end only.
#[error_code]
pub enum PegDeskError {
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Market is closed (sell-only)")]
    MarketClosed,
    #[msg("Market is halted")]
    MarketHalted,
    #[msg("Oracle price is stale")]
    StaleOracle,
    #[msg("Oracle publish time went backwards")]
    OracleNotMonotonic,
    #[msg("Oracle confidence interval too wide")]
    ConfidenceTooWide,
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("Per-transaction cap exceeded")]
    PerTxCapExceeded,
    #[msg("Supply cap exceeded")]
    SupplyCapExceeded,
    #[msg("Reserve vault cannot cover this redemption")]
    ReserveInsufficient,
    #[msg("Reserve ratio too low")]
    ReserveRatioTooLow,
    #[msg("Invalid oracle kind for this operation")]
    InvalidOracleKind,
    #[msg("Invalid or mismatched price feed account")]
    InvalidFeed,
    #[msg("Keeper price move exceeds max_move_bps")]
    MoveTooLarge,
    #[msg("Keeper price update too soon")]
    TooSoon,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid index legs")]
    InvalidLegs,
    #[msg("Invalid symbol")]
    InvalidSymbol,
    // ---- additions beyond CONTRACTS.md ----
    #[msg("Invalid parameter")]
    InvalidParams,
    #[msg("Too many keepers")]
    TooManyKeepers,
    #[msg("Invalid status or status transition")]
    InvalidStatus,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Oracle price must be positive")]
    NonPositivePrice,
    #[msg("Daily mint cap exceeded for this commodity")]
    DailyMintCapExceeded,
    #[msg("Daily redemption cap exceeded for this commodity")]
    DailyRedeemCapExceeded,
    #[msg("Oracle price deviates too far from the last accepted price")]
    PriceDeviationTooLarge,
    #[msg("Payer is not the program's upgrade authority")]
    NotUpgradeAuthority,
}
