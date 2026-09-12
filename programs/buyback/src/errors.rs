use anchor_lang::prelude::*;

#[error_code]
pub enum BuybackError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Buyback is paused")]
    Paused,
    #[msg("Too many keepers (max 8)")]
    TooManyKeepers,
    #[msg("Invalid bps")]
    InvalidBps,
    #[msg("Nothing to convert")]
    ZeroAmount,
    #[msg("Invalid mint for this operation")]
    InvalidMint,
    #[msg("Invalid program id")]
    InvalidProgram,
    #[msg("Route data too long")]
    RouteTooLong,
    #[msg("Swap output below minimum")]
    SlippageExceeded,
    #[msg("Swap rate below the anchored rate by more than max_deviation_bps")]
    RateBelowAnchor,
    #[msg("fee_router did not deliver the requested amount")]
    WithdrawMismatch,
    #[msg("peg_desk sell returned less USDC than min_usdc_out")]
    SellBelowMinimum,
    #[msg("Swap consumed more USDC than the sell produced")]
    UsdcOverspent,
    #[msg("Cycle too soon (min_interval_secs)")]
    TooSoon,
    #[msg("USDC out exceeds max_per_cycle_usdc")]
    CycleCapExceeded,
    #[msg("Math overflow")]
    MathOverflow,
}
