pub mod admin;
pub mod claim_damm;
pub mod claim_dbc;
pub mod claim_dbc_surplus;
pub mod common;
pub mod initialize_router;
pub mod record_migration;
pub mod register_pool;
pub mod withdraw;

// Glob re-exports bring the `#[derive(Accounts)]` structs (and their generated
// `__client_accounts_*` modules) to the crate root, as Anchor's `#[program]` macro expects.
// Handler fns have unique names to avoid ambiguous glob re-exports.
pub use admin::*;
pub use claim_damm::*;
pub use claim_dbc::*;
pub use claim_dbc_surplus::*;
pub use initialize_router::*;
pub use record_migration::*;
pub use register_pool::*;
pub use withdraw::*;
