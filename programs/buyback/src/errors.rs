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
    #[msg("Only the GLD path is supported in MVP")]
    UnsupportedCoin,
    #[msg("Invalid program id")]
    InvalidProgram,
    #[msg("Invalid DAMM v2 pool")]
    InvalidPool,
    #[msg("Swap output below minimum")]
    SlippageExceeded,
    #[msg("fee_router did not deliver the requested amount")]
    WithdrawMismatch,
    #[msg("Math overflow")]
    MathOverflow,
}
