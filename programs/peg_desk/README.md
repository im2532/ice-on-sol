# peg_desk

Issues ICEmarkets commodity coins (GLD, SLV, CL, …) against a per-commodity USDC reserve.
Interface contract: [`docs/CONTRACTS.md` §1](../../docs/CONTRACTS.md). Spec: `docs/ICEMARKETS_SPEC.md` §3.1A, §3.4.

## Design

- **Mint on buy / burn on sell at the oracle price, with a spread.** `buy` moves USDC into
  `reserve_vault` and mints COIN at `ask = p·(1+s)`. `sell` burns COIN and pays `bid = p·(1−s)` from the
  vault. The desk has no inventory and no quote a bot can pick off while it is stale. The price is read
  when the trade executes.
- **Spread** (`pricing::effective_spread_bps`): `base` (or `closed_spread` when Closed) + `conf_mult ×
  conf/p (in %)` + age penalty (0 up to `max_age/2`, rising linearly to `+base` at `max_age`), doubled when
  the pre-trade reserve ratio is below `reserve_warn_bps`, and capped at 50%. All rounding favours the
  reserve: ask, usdc-in and spread terms round up; coin-out, usdc-out and bid round down.
- **Guards in trades:** global pause, status (Open = buy+sell, Closed = sell only, Halted = none),
  `age ≤ max_age(status)`, `publish_time ≥ last_publish_time` (so a trader can't pick an older
  update), `conf/p ≤ max_conf_bps`, `per_tx_cap`, `supply_cap`, and buys revert when the post-trade
  reserve ratio falls below `reserve_halt_bps`. Sells revert with `ReserveInsufficient` when the vault
  can't pay, and emit `ReserveAlert` below the warn level.
- **Oracles** (`oracle.rs`), all normalised to USD at 1e8:
  - `PythPull`: reads a `PriceUpdateV2` at `commodity.feed_account` and checks the owner (the Pyth
    receiver), the feed id and the verification level. `pyth_min_signatures == 0` means
    `VerificationLevel::Full` is required. Any other value accepts `Partial{n ≥ min}`. Prices in US cents
    are divided by 100. EUR prices are multiplied by the EUR/USD feed, and the older of the two
    publish times is used.
  - `KeeperSigned`: `KeeperPrice` PDA `["kp", commodity]`, written by `keeper_update_price`. Each
    update must have a strictly newer `publish_time`, arrive at least `min_interval` after the last
    one, and move at most `max_move_bps` (default ±5%). The keeper posts prices already in USD at 1e8.
  - `Switchboard`: **stand-in.** Reads a `KeeperPrice`-shaped account at `feed_account`. The code
    for the `switchboard-on-demand` crate is left as a TODO.
  - `Composite`: a weighted sum of up to 5 legs. The legs come in through `remaining_accounts` as
    `[leg Commodity, leg source]` pairs. Every leg must be fresh by its own status, and the index
    must also be fresh by its own `max_age` using the oldest leg. Legs can't be Composite or
    EUR-quoted.
- **Authorities:** one `mint_auth` PDA mints every COIN. Each COIN has no freeze authority, and the
  admin holds the Metaplex update authority. Each `reserve_vault` is a PDA token account at
  `["reserve", commodity]` owned by the commodity PDA, and only buys/sells/sweeps move funds out of it.
- **Fees:** the spread stays in the reserve. `sweep_spread_fees` (keeper or admin) moves USDC to the
  treasury only if the post-sweep ratio, valued at `last_price`, stays ≥ `reserve_warn_bps` (102%).
  `last_price` must also be within `max_age`.
- **Admin model:** the admin changes in two steps (`propose_admin` / `accept_admin`). Keepers can
  pause, flip Open↔Closed, halt, and rotate feed accounts. Only the admin can unpause, move a market
  out of Halted, or change risk parameters.

`rebalance_hedge` (hedge vault, PDA `["hedge", commodity]`) is v1.1 and exists only as a TODO in `lib.rs`.

## Deviations from CONTRACTS.md (please fold back into the doc)

1. **Program id.** `PegDesk111111111111111111111111111111111111` (44 chars) decodes to 33 bytes, so
   `declare_id!` rejects it. `lib.rs` uses the 43-char `PegDesk111111111111111111111111111111111111`.
   **Update `Anchor.toml` and `packages/registry/src/programs.ts`** to match, or run `anchor keys sync`
   and use the real keypair address. `FeeRoutr…`, `Distrib…` and `Buyback…` are valid 32-byte keys.
2. **Reserve vault** is a PDA token account at `["reserve", commodity]`, not an ATA. That uses the
   `reserve` seed from the seed list. The contract table said "ATA".
3. **`IndexLeg`** is Borsh (`AnchorSerialize`), not `#[zero_copy]`, because it sits inside a Borsh
   account. The bytes are identical (40 bytes).
4. **`Commodity.pyth_min_signatures: u8`** takes 1 byte of `_reserved` (now `[u8; 63]`), so the
   account stays byte-compatible.
5. **New instruction `set_keeper_bounds(max_move_bps, min_interval)`** (admin). `KeeperPrice` is
   created by the first `keeper_update_price` with defaults 500 bps / 0 s.
6. `CreateCommodityArgs` also takes `feed_account`, `fx_feed_account` and `pyth_min_signatures`.
   New markets start **Open**.
7. `sell` has no `treasury_usdc` account (the spread stays in the reserve until it is swept).
   `sweep_spread_fees` needs `coin_mint` (for supply). `sweep_spread_fees` also accepts the admin.
   `per_tx_cap` applies to sells as well.
8. Extra errors (appended after the listed ones, so codes stay stable): `InvalidParams`,
   `TooManyKeepers`, `InvalidStatus`, `ZeroAmount`, `NonPositivePrice`. Extra events: `ConfigInitialized`,
   `KeepersSet`, `AdminProposed`, `AdminChanged`, `GlobalPauseSet`, `SpreadFeesSwept`, `ReserveDeposited`.
   `ReserveAlert.ratio_bps` is `u64`.

## Tests

- `pricing.rs` has no dependencies, so its 21 unit tests (rounding, overflow at max supply, closed
  spread, age penalty, cents, EUR fx, composite) run under `cargo test -p peg_desk`. They were also run
  standalone with `rustc --test`, and all passed.
- `tests/peg_desk.test.ts` needs `anchor test`. It uses a KeeperSigned GLD, so it needs no Pyth.
  It **does** need Metaplex on the validator, which Anchor.toml clones from mainnet (network
  required at validator start).

## Compile-risk spots (written without network — no `cargo build` was possible)

- **`pyth-solana-receiver-sdk 0.6.1` vs `anchor-lang 0.31.1`:** the SDK must use the same
  `anchor-lang`/`solana-program` versions, or `PriceUpdateV2::try_deserialize` (`AccountDeserialize`)
  and `&Clock` will mismatch. Check `cargo tree -i anchor-lang`. Method names used:
  `get_price_no_older_than`, `get_price_no_older_than_with_custom_verification_level`, the fields
  `price_message.feed_id` and `verification_level`, and `pyth_solana_receiver_sdk::ID` for the owner check.
- **`anchor_spl::metadata`** (feature `metadata`): `create_metadata_accounts_v3(ctx, DataV2, is_mutable,
  update_authority_is_signer, None)`, `CreateMetadataAccountsV3 { metadata, mint, mint_authority, payer,
  update_authority, system_program, rent }`, `mpl_token_metadata::types::DataV2`, `Program<'info, Metadata>`.
- **`CreateCommodity` field order**: every account an `init` constraint references is declared above it.
  Check that `seeds::program = token_metadata_program.key()` on the metadata `UncheckedAccount`
  compiles. Watch the build output for BPF stack-frame warnings on `try_accounts`. All large accounts
  are already `Box`ed.
- **Optional accounts** `Option<UncheckedAccount<'info>>` in `TradeAccounts` (clients pass `null`).
- **Lifetimes**: `buy`/`sell`/`buy_exact_out` use `Context<'_, '_, '_, 'info, TradeAccounts<'info>>` so
  `remaining_accounts` and the account struct share `'info`.
- `#![allow(deprecated)]` in `trade.rs` covers `token::transfer`. Switch to `transfer_checked` if you
  prefer. That adds the USDC mint to the trade accounts.
- `init_if_needed` on `KeeperPrice` relies on the workspace `anchor-lang` feature `init-if-needed`,
  which is already set.
- `idl-build` = `anchor-lang/idl-build` + `anchor-spl/idl-build`. No Pyth type appears in any
  `#[derive(Accounts)]` or in instruction args, so the Pyth SDK doesn't need an `idl-build` feature.
