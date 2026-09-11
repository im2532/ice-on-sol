//! Thin, hand-rolled CPI into Meteora programs (no git-crate dependency).
//!
//! Named `cpi_ext` (not `cpi`) because Anchor's `#[program]` macro generates a crate-root `cpi` module.
//!
//! Every discriminator is `sha256("global:<ix_name>")[..8]` (Anchor convention); run
//! `pnpm exec tsx scripts/print-discriminators.ts` to regenerate, and pass Meteora IDL json paths to
//! diff against the IDLs once network is available.
//!
//! Anchor `#[event_cpi]` instructions take two trailing accounts: `event_authority`
//! (PDA["__event_authority"] of the callee) and the callee `program` itself. Both DBC and DAMM v2 use
//! `#[event_cpi]` on the instructions called here — VERIFY ORDER vs IDL.

pub mod damm_v2;
pub mod dbc;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

/// Build instruction data = 8-byte discriminator ++ borsh-encoded args.
pub fn ix_data(discriminator: [u8; 8], args: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + args.len());
    data.extend_from_slice(&discriminator);
    data.extend_from_slice(args);
    data
}

pub fn meta(info: &AccountInfo, is_writable: bool, is_signer: bool) -> AccountMeta {
    if is_writable {
        AccountMeta::new(*info.key, is_signer)
    } else {
        AccountMeta::new_readonly(*info.key, is_signer)
    }
}

pub fn build_ix(program_id: Pubkey, accounts: Vec<AccountMeta>, data: Vec<u8>) -> Instruction {
    Instruction {
        program_id,
        accounts,
        data,
    }
}
