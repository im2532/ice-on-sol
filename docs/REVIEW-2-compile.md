# Review 2: compile pass (human compiler), 2026-09-11

**Scope:** every `.rs` file and `Cargo.toml` under `programs/{peg_desk,fee_router,distributor,buyback}`
(38 source files, about 6.6k lines), read line by line.

**Target:** Anchor 0.31.1, anchor-spl 0.31.1 (+`metadata`), pyth-solana-receiver-sdk 0.6.1, solana-program 2.1.x.

There was no network and no crate cache (`~/.cargo/registry` is empty), so `anchor build` / `cargo check` could not run.
What could be executed offline:

- `peg_desk/src/pricing.rs` + `constants.rs` compiled standalone with `rustc --test`: 21/21 tests pass.
- All four `declare_id!` strings base58-decode to 32 bytes.
- `DBC_PROGRAM_ID` / `DAMM_V2_PROGRAM_ID` byte arrays equal the decoded `dbcij3…` / `cpamdp…` ids.
- Every hand-coded discriminator was recomputed with `sha256("global:<ix>")[..8]` / `sha256("account:<T>")[..8]` and matches:
  - `withdraw_for_epoch`, `withdraw_for_buyback`
  - `claim_trading_fee`, `partner_withdraw_surplus`, `migrate_damm_v2`
  - `claim_position_fee`, `swap`
  - `PoolConfig`, `VirtualPool`, `Pool`, `Position`

## Fixes applied

| # | File:line | Before → after |
|---|-----------|----------------|
| 1 | `programs/distributor/src/instructions/open_epoch.rs:50-54` | `epoch_vault`: `init` → `init_if_needed` (+ doc). **Logic/DoS:** anyone can create the ATA of the not-yet-existing Epoch PDA, which made `open_epoch` for that `(pool, index)` fail forever. |
| 2 | `programs/distributor/src/instructions/open_epoch.rs:90,156` | `require!(epoch_vault.amount == total_amount)` → record `vault_before` and require `amount - vault_before == total_amount`. **Logic:** without this, a single base unit of COIN donated to that ATA would also brick the epoch. Surplus is swept by `sweep_unclaimed`. Accounts, args and IDL are unchanged, so the keeper, SDK and tests need no change. |

**No hard compile errors were found.** Every item on the checklist was checked; the results are below.

## Checklist results (no change needed)

### Imports and attributes
- Every used type is imported. There are no dangling paths.
- Explicit `AccountMeta` imports alongside `prelude::*` are legal: the explicit import shadows the glob.
- `#![allow(deprecated)]` is the first attribute after `//!` in `peg_desk/src/instructions/trade.rs`. That is valid at module top and covers every `token::transfer` call.
- `keccak` is imported as `anchor_lang::solana_program::keccak::hashv(..).to_bytes()`.

### Account safety and constraints
- **`/// CHECK:`** is present on all 45 `UncheckedAccount` / `Option<UncheckedAccount>` fields; this was verified by script plus a manual look at `CreateCommodity.metadata`. No bare `AccountInfo` field exists in any `#[derive(Accounts)]`.
- **Constraints:**
  - Every `has_one` target exists on both the account struct and the data struct.
  - `init` fields come after every account they reference.
  - Non-init seeds that reference later fields are fine, because constraints run after all fields are deserialized.
  - `seeds::program = token_metadata_program.key()` is valid.
  - `mint::decimals` / `mint::authority` with no `freeze_authority` gives a mint with no freeze authority.
  - `token::token_program` / `associated_token::token_program` are valid 0.30+ syntax.
  - `owner = X @ E` and `address = X @ E` are valid on `UncheckedAccount` and `InterfaceAccount`.
  - `init_if_needed` is enabled through workspace `anchor-lang` features.
- **Seeds with temporaries** (`&args.index.to_le_bytes()`, `epoch.key().as_ref()`, `b"metadata"`): Anchor inlines them into the call expression, and the IDL seed parser accepts them.

### Types, signatures and CPIs
- **`InitSpace`:**
  - `[Pubkey; 8]`, `[u8; N]` and `u128` are fine.
  - `[IndexLeg; 5]` is fine because `IndexLeg` derives `InitSpace`.
  - No `Vec`/`String` fields appear in accounts.
  - The `OracleKind` / `SessionKind` / `Status` enums are deliberately not Borsh-derived and are stored as `u8`.
- **Instruction args:** `CreateCommodityArgs`, `SetParamsArgs` (both crates), `InitializeRouterArgs`, `OpenEpochArgs`, `PayoutItem`, `InitializeArgs` and `IndexLeg` all derive `AnchorSerialize, AnchorDeserialize, Clone`. This also covers `IdlBuild` under `idl-build`.
- **Handlers:**
  - All are `-> Result<()>`.
  - Remaining-accounts handlers use `Context<'_, '_, '_, 'info, T<'info>>` in peg_desk. There, the `'info` of `AccountInfo` is what must be tied; `&[AccountInfo<'info>]` is only read.
  - The distributor uses `Context<'_, '_, 'info, 'info, T<'info>>`, where `remaining_accounts[i].clone()` goes into a CPI.
  - `ctx.bumps.<field>` is used everywhere; there is no `bumps.get`.
  - Borrow scopes check out (e.g. `let a = &ctx.accounts` ends before `&mut ctx.accounts.pool_state`; `&mut Box<Account<T>>` coerces to `&T` / `&mut T`).
  - Partial moves (`let a = ctx.accounts;`, `args.name` moved while `args.symbol: Copy` is used later) are legal.
- **Signer seeds:** all are `let s: &[&[&[u8]]] = &[&[SEED, &arr, &bump]]` with named locals, so there are no dropped temporaries.
- **CPI helpers:**
  - `token::{transfer, mint_to, burn}` and `token_interface::{transfer_checked, burn}` have the right arities.
  - `create_metadata_accounts_v3(ctx, DataV2{..7 fields}, is_mutable, update_authority_is_signer, None)` matches anchor-spl 0.31.1.
  - Raw `invoke_signed(&ix, &[AccountInfo..], seeds)?` gets `ProgramError → Error` via `From`.
- **Pyth:**
  - `PriceUpdateV2::try_deserialize` works because `AccountDeserialize` is in the prelude.
  - `VerificationLevel::{Full, Partial{num_signatures}}` is matched correctly.
  - `get_price_no_older_than(&Clock, u64, &[u8;32])` and `get_price_no_older_than_with_custom_verification_level(.., VerificationLevel)` are called correctly, and both are `.map_err`'d so the error type doesn't matter.
  - `Price{price,conf,exponent,publish_time}` fields are read correctly, and the owner check uses `pyth_solana_receiver_sdk::ID`.
- **Errors and events:** every enum is `#[error_code]`, and `require!`, `err!`, `error!`, `.ok_or(error!(..))`, `require_keys_eq!` and `require_keys_neq!` are all used correctly. All events are `#[event]` + `emit!`.
- **Program modules:**
  - Each `#[program]` has `use super::*`, and the crate root has `pub use instructions::*`. Instruction modules glob-re-export their Accounts structs, so `__client_accounts_*` / `__cpi_client_accounts_*` resolve at the crate root.
  - Private `use crate::events::X` imports are not re-exported, so `Trade` / `Buyback` / `Payout` don't collide.
  - Hand-built CPI modules are named `cpi_ext`, which avoids a clash with the generated `cpi` module.
  - Handler names are unique across globbed modules.

### Build config and math
- **Cargo.toml (4/4):**
  - `crate-type = ["cdylib","lib"]` and `name`.
  - Features: `default=[]`, `cpi=["no-entrypoint"]`, `no-entrypoint`, `no-idl`, `no-log-ix-name`, `idl-build=["anchor-lang/idl-build","anchor-spl/idl-build"]`, plus `anchor-debug`/`custom-heap`/`custom-panic` for cfg hygiene.
  - peg_desk adds anchor-spl `metadata` and the pyth SDK.
  - The workspace sets `overflow-checks = true`.
- **Stack:** every `Account`/`InterfaceAccount` in every Accounts struct is `Box`ed. The biggest locals are about 5 × `Commodity` (≈ 540 B, sequential) in `read_composite`, and `[(u64,u16);5]` arrays. Both are fine.
- **Math:**
  - Every u128 intermediate is either provably ≤ its u64 input (split / buffer / cap: `x*bps/10_000` with bps ≤ 10_000) or goes back through `u64::try_from` (pricing).
  - Accumulators use `checked_add`.
  - `weight_sum` is bounded (≤ 5 × 65 535).

## Logic sanity (no change needed)

- **Auth:** every admin or keeper instruction checks its signer:
  - `has_one = admin`, or `require_admin` / `require_admin_or_keeper` / `is_admin_or_keeper`.
  - `withdraw_for_*` checks the signer against `find_program_address([seed], cfg.program)`.
  - `register_pool_admin` checks `payer == admin`.
  - Permissionless instructions are permissionless on purpose: `register_pool` has byte validation, `claim_*` has the 900 s gate and fixed-PDA destinations, and `deposit_reserve`, trades and `claim` are open to anyone.
- **Mutability:** every written or CPI-debited account is `mut`:
  - `coin_mint` on mint/burn, `ice_mint` on burn.
  - The vaults, the destinations, and `pool_state`/`epoch`/`commodity` where they are written.
  - `remaining_accounts` destinations check `is_writable`.
- **`reserve_balance_cached`** is refreshed after `reload()` in `buy`, `buy_exact_out`, `sell`, `sweep_spread_fees` and `deposit_reserve` (the only instructions that move reserve USDC).
- **Oracle guards:** staleness, monotonic `last_publish_time`, and the conf/price cap are applied before any transfer. Closed markets are sell-only and Halted markets reject everything. The buy post-ratio is checked against `reserve_halt_bps`, and sweeps against `reserve_warn_bps` at a fresh `last_price`.

## Remaining uncertainties (cannot be settled offline)

1. **Dependency resolution / toolchain (highest risk for `anchor build`).**
   - There is no `Cargo.lock`, and anchor-lang 0.31.1 accepts any `solana-program` 2.x, so a fresh resolve picks the newest 2.x crates. `Anchor.toml` pins `solana_version = "2.1.21"`, whose platform-tools ship rustc/cargo 1.79. That cargo cannot parse `edition2024` manifests or build crates whose `rust-version` > 1.79, and some deps already require that (known offenders in this tree are `base64ct` ≥ 1.8 and newer `bytemuck_derive` / solana 2.2+ sub-crates).
   - To fix: generate and commit a `Cargo.lock` on a networked machine, with offenders pinned via `cargo update -p <crate> --precise <ver>`. Alternatively, move to an Agave 2.2.x+ toolchain (rustc ≥ 1.84).
   - `[lints.rust] check-cfg` in `peg_desk/Cargo.toml` needs cargo ≥ 1.80. On older cargo it is only an "unused key" warning.
2. **pyth-solana-receiver-sdk 0.6.1 ↔ anchor-lang 0.31.1 unification.**
   - `oracle.rs` depends on `PriceUpdateV2` implementing *our* anchor-lang's `AccountDeserialize` (one unified anchor-lang), and on the SDK's `#[account]` / `pythnet-sdk` types compiling under `anchor-lang/idl-build` (`anchor build` enables that feature for the whole graph).
   - If the SDK pulls a second anchor-lang or fails under `idl-build`, the fallback is to decode the account manually. The fields are disc 8, `write_authority` 32, `VerificationLevel` borsh enum (`Partial`=0 + u8 / `Full`=1), `PriceFeedMessage {feed_id[32], price i64, conf u64, exponent i32, publish_time i64, prev_publish_time i64, ema_price i64, ema_conf u64}`, then `posted_slot` u64. Keep the owner check.
3. **`solana_program::keccak`.** It exists in solana-program 2.1. If 2.2+ resolves, the re-export may carry a `#[deprecated]`, which is a warning only.
4. **Meteora raw layouts and account orders (runtime, not compile).** These are unchanged from the previous review and still carry `VERIFY OFFSET` / `VERIFY ORDER`:
   - DBC `PoolConfig` / `VirtualPool` offsets, DAMM `Position` offsets.
   - The `claim_trading_fee` / `partner_withdraw_surplus` / `claim_position_fee` / `swap` account lists.
   - Run `scripts/print-discriminators.ts --check <idl.json>` once network is available.
5. **Stack-frame warnings.** `RegisterPool::try_accounts` (6 init/init_if_needed accounts) and `CreateCommodity::try_accounts` are the most likely to print an LLVM "Stack offset exceeded" warning. Everything is already boxed. If the warning shows up, split `RegisterPool` (e.g. create `treasury_base` / `buyback_vault` in a separate instruction).
6. **IDL seed extraction.** Self-referencing seeds (`pool_state.dbc_pool`, `epoch.pool`, `&epoch.index.to_le_bytes()`) are supported by the 0.31 parser. If a seed fails to parse, the IDL just omits `pda`; the build does not fail.
