# ICEmarkets on-chain interface contract (v0.1)

This file is the single source of truth for instruction names, account layouts, PDA seeds and events.
Programs implement it; the SDK, keeper, indexer and tests consume it. Change here first.

Conventions: Anchor 0.31.1, `declare_id!` placeholders from Anchor.toml, all amounts `u64` in base units,
prices `u64` with `PRICE_EXPO = -8` (i.e. 1e8 = $1.00), bps `u16`. Every mutable instruction emits an event.
Admin = `GlobalConfig.admin` (Squads vault on mainnet). Keeper = any key in `GlobalConfig.keepers`.

---

## 1. `peg_desk`

Seeds (`constants.rs`): `config`, `cmdty` + symbol bytes (padded to 12), `reserve` + commodity key, `hedge` + commodity key,
`kp` + commodity key, `mint_auth` (single PDA mint authority for all coins).

### Accounts

```rust
#[account] pub struct GlobalConfig {           // PDA["config"]
  pub admin: Pubkey, pub pending_admin: Pubkey,
  pub keepers: [Pubkey; 8], pub keeper_count: u8,
  pub treasury: Pubkey,                        // receives spread fees (USDC ATA owner)
  pub reserve_mint: Pubkey,                    // USDC
  pub global_pause: bool,
  pub max_conf_bps: u16,                       // reject oracle if conf/price > this (default 200)
  pub reserve_warn_bps: u16, pub reserve_halt_bps: u16, // 10200, 9800
  pub bump: u8, pub _reserved: [u8; 64],
}

#[repr(u8)] pub enum OracleKind { PythPull=0, Switchboard=1, KeeperSigned=2, Composite=3 }
#[repr(u8)] pub enum SessionKind { Continuous=0, CmeGlobex=1, IceUs=2, Lme=3, Slow=4 }
#[repr(u8)] pub enum Status { Open=0, Closed=1, Halted=2 }   // Closed = sell-only at closed_spread

#[account] pub struct Commodity {              // PDA["cmdty", symbol[12]]
  pub symbol: [u8; 12], pub coin_mint: Pubkey, pub decimals: u8,   // decimals = 6
  pub oracle_kind: u8, pub session_kind: u8, pub status: u8,
  pub feed_id: [u8; 32],                       // Pyth feed id (or Switchboard feed pubkey bytes)
  pub feed_account: Pubkey,                    // PythPull: PriceUpdateV2 posted by keeper; Switchboard: quote acct
  pub fx_feed_id: [u8; 32], pub fx_feed_account: Pubkey, // EUR→USD when quote_scale_kind == Eur
  pub quote_scale: u8,                         // 0 = USD, 1 = US cents (÷100), 2 = EUR (× fx)
  pub base_spread_bps: u16, pub closed_spread_bps: u16, pub conf_mult_bps: u16,
  pub max_age_open: u32, pub max_age_closed: u32,
  pub supply_cap: u64, pub per_tx_cap: u64,    // in coin base units
  pub last_publish_time: i64, pub last_price: u64,   // last accepted oracle (monotonic guard)
  pub reserve_vault: Pubkey, pub hedge_vault: Pubkey,
  pub reserve_balance_cached: u64,             // for reserve-ratio check without extra reads
  pub legs: [IndexLeg; 5], pub leg_count: u8,  // Composite only
  pub bump: u8, pub _reserved: [u8; 64],
}
#[zero_copy] pub struct IndexLeg { pub commodity: Pubkey, pub weight_bps: u16, pub _pad: [u8; 6] }

#[account] pub struct KeeperPrice {            // PDA["kp", commodity]
  pub commodity: Pubkey, pub price: u64, pub conf: u64, pub publish_time: i64,
  pub source_hash: [u8; 32], pub max_move_bps: u16, pub min_interval: u32, pub bump: u8,
}
```

### Instructions

| ix | signer | accounts (mut*) | args | notes |
|---|---|---|---|---|
| `initialize_config` | payer (becomes admin) | config*, reserve_mint, treasury | `max_conf_bps, reserve_warn_bps, reserve_halt_bps` | once |
| `set_keepers` | admin | config* | `keepers: Vec<Pubkey>` | ≤ 8 |
| `propose_admin` / `accept_admin` | admin / pending | config* | `new_admin` | 2-step |
| `set_global_pause` | admin or keeper | config* | `paused: bool` | keeper may pause, only admin may unpause |
| `create_commodity` | admin | config, commodity*, coin_mint* (init, decimals 6, mint_auth PDA, **freeze authority None**), reserve_vault* (init ATA owner=commodity PDA), metadata* (Metaplex CPI), payer | `CreateCommodityArgs { symbol, oracle_kind, session_kind, feed_id, fx_feed_id, quote_scale, params… , name, uri }` | emits `CommodityCreated` |
| `set_commodity_params` | admin | commodity* | `SetParamsArgs` (all Option<>) | emits `ParamsUpdated` |
| `set_feed_account` | admin or keeper | commodity* | `feed_account, fx_feed_account` | keeper may rotate Pyth update accounts |
| `set_status` | admin or keeper | commodity* | `status` | keeper: Open↔Closed and →Halted; admin only Halted→Open |
| `set_index_legs` | admin | commodity*, leg commodities (remaining) | `legs` | Composite only |
| `keeper_update_price` | keeper | commodity, keeper_price* | `price, conf, publish_time, source_hash` | bounded by `max_move_bps`, `min_interval`; KeeperSigned only |
| `buy` | user | config, commodity*, coin_mint*, mint_auth, reserve_vault*, user_usdc*, user_coin*, feed_account(s), keeper_price (if KS), leg feeds (if Composite, remaining) | `usdc_in: u64, min_coin_out: u64` | price = oracle × (1+spread); mint; checks caps, status==Open, staleness, conf, monotonic |
| `buy_exact_out` | user | same | `coin_out: u64, max_usdc_in: u64` | used by launch builder |
| `sell` | user | same (+ treasury_usdc* for spread fee) | `coin_in: u64, min_usdc_out: u64` | burn; pay from reserve; allowed in Open **and** Closed; reverts if reserve insufficient (`ReserveInsufficient`) |
| `sweep_spread_fees` | keeper | commodity*, reserve_vault*, treasury_usdc* | `amount` | only above 102% reserve ratio |
| `rebalance_hedge` | admin or keeper | commodity*, reserve_vault*, hedge_vault* … | `amount, direction` | backlog (not part of v1.0 — no release phases; tracked in docs/BUILD_STATUS.md); transfers USDC↔hedge asset via Jupiter CPI — v1.0 implements only a manual `deposit_reserve` |
| `deposit_reserve` | anyone | commodity*, reserve_vault*, from* | `amount` | seed capital / top-ups |

### Pricing (shared `pricing.rs`, pure functions, unit-tested)

```
p            = oracle_price_usd (after quote_scale + fx)            // 1e8 fixed
spread_bps   = base (or closed_spread if status==Closed) + conf_mult_bps * (conf / p) [in %] + age_penalty
age_penalty  = 0 if age ≤ max_age/2 else linear up to +base_spread at max_age
ask          = p * (10_000 + spread_bps) / 10_000
bid          = p * (10_000 - spread_bps) / 10_000
coin_out     = usdc_in * 1e6(coin dec) / ask * 1e8/1e6(usdc dec)   → implement with u128, round down
usdc_out     = coin_in * bid / 1e8 …                                 → round down
```

Guards in `buy`/`sell`: `!global_pause`, status rule, `now - publish_time ≤ max_age(status)`, `publish_time ≥ last_publish_time`,
`conf * 10_000 / p ≤ max_conf_bps`, `coin_out ≤ per_tx_cap`, `supply + coin_out ≤ supply_cap`, reserve ratio after trade
(`reserve_balance * 1e8 / (supply * p)`): buy blocked if < `reserve_halt_bps`; spread widened ×2 if < `reserve_warn_bps`.

Pyth: `pyth_solana_receiver_sdk::price_update::PriceUpdateV2::get_price_no_older_than(&Clock, max_age, &feed_id)`.
Verification level: require `VerificationLevel::Full` for Tier A; accept `Partial{num_signatures ≥ 5}` for others (param).

### Events
`CommodityCreated{commodity, symbol, mint}`, `Trade{commodity, user, side(0 buy/1 sell), usdc, coin, price, spread_bps}`,
`PriceUpdated{commodity, price, conf, publish_time}`, `StatusChanged{commodity, status}`, `ReserveAlert{commodity, ratio_bps}`, `ParamsUpdated{commodity}`.

### Errors
`Paused, MarketClosed, MarketHalted, StaleOracle, OracleNotMonotonic, ConfidenceTooWide, SlippageExceeded, PerTxCapExceeded,
SupplyCapExceeded, ReserveInsufficient, ReserveRatioTooLow, InvalidOracleKind, InvalidFeed, MoveTooLarge, TooSoon,
Unauthorized, MathOverflow, InvalidLegs, InvalidSymbol`.

---

## 2. `fee_router`

Seeds: `router` (authority PDA = DBC `fee_claimer` and DAMM v2 position owner), `pool` + dbc_pool key,
`holder_vault` + dbc_pool key (COIN ATA owned by pool_state PDA), `buyback_vault` + coin_mint, `treasury` + coin_mint.

```rust
#[account] pub struct RouterConfig {  // PDA["router"]
  pub admin: Pubkey, pub keepers: [Pubkey;8], pub keeper_count: u8,
  pub distributor_program: Pubkey, pub buyback_program: Pubkey,
  pub holders_bps: u16, pub buyback_bps: u16, pub protocol_bps: u16,   // 5000/2500/2500
  pub paused: bool, pub bump: u8, pub _reserved: [u8;64],
}
#[account] pub struct PoolState {     // PDA["pool", dbc_pool]
  pub dbc_pool: Pubkey, pub dbc_config: Pubkey, pub base_mint: Pubkey, pub quote_mint: Pubkey /*COIN*/,
  pub commodity: Pubkey, pub creator: Pubkey, pub fee_bps: u16,
  pub migrated: bool, pub damm_pool: Pubkey, pub damm_position: Pubkey, pub position_nft_mint: Pubkey,
  pub total_claimed: u64, pub total_to_holders: u64, pub total_to_buyback: u64, pub total_to_protocol: u64,
  pub last_claim_ts: i64, pub bump: u8, pub _reserved: [u8;64],
}
```

| ix | signer | notes |
|---|---|---|
| `initialize_router` | payer→admin | sets split, programs |
| `register_pool` | anyone (permissionless; validates `dbc_pool.config.fee_claimer == router PDA`) | creates PoolState + holder_vault; called by launch builder right after DBC init |
| `claim_dbc` | keeper (or permissionless when `ts - last_claim_ts > 900`) | CPI `dynamic_bonding_curve::claim_trading_fee(max_base=0, max_quote=u64::MAX)`; then split |
| `claim_dbc_surplus` | keeper | CPI `partner_withdraw_surplus`; split |
| `record_migration` | anyone | reads dbc pool `is_migrated`, stores damm_pool/position (validate owner == router PDA) |
| `claim_damm` | keeper / permissionless as above | CPI `cp_amm::claim_position_fee`; split; base-token side (memecoin) is **sold into the DAMM pool for COIN by CPI swap** before split (backlog, not part of v1.0) — v1.0: forward base to treasury |
| `split` (internal) | — | `holders → holder_vault[pool]`, `buyback → buyback_vault[coin]`, `protocol → treasury[coin]`; emits `FeesSplit` |
| `set_split` / `set_keepers` / `pause` | admin | |

Events: `PoolRegistered{pool, base_mint, quote_mint, commodity, fee_bps}`, `FeesClaimed{pool, source(0 dbc/1 surplus/2 damm), quote_amount, base_amount}`, `FeesSplit{pool, holders, buyback, protocol}`, `MigrationRecorded{pool, damm_pool}`.

---

## 3. `distributor`

Seeds: `dist` (config), `epoch` + pool + epoch_index(u32 LE), `claimed` + epoch + wallet.

```rust
#[account] pub struct DistConfig { pub admin: Pubkey, pub keepers:[Pubkey;8], pub keeper_count:u8, pub fee_router: Pubkey,
  pub max_push_per_epoch_bps: u16 /*10000*/, pub paused: bool, pub bump:u8 }
#[account] pub struct Epoch {  // PDA["epoch", pool, index]
  pub pool: Pubkey, pub index: u32, pub coin_mint: Pubkey, pub start_ts: i64, pub end_ts: i64,
  pub total_amount: u64, pub pushed_amount: u64, pub merkle_root: [u8;32], pub merkle_total: u64, pub claimed_amount: u64,
  pub eligible_holders: u32, pub twab_total: u128, pub finalized: bool, pub bump: u8 }
#[account] pub struct Claimed { pub epoch: Pubkey, pub wallet: Pubkey, pub amount: u64, pub bump: u8 }
```

| ix | signer | notes |
|---|---|---|
| `open_epoch` | keeper | `index, start_ts, end_ts, total_amount, eligible_holders, twab_total`; moves `total_amount` from `holder_vault[pool]` (fee_router CPI `withdraw_for_epoch`, router PDA signs) into `epoch_vault` (COIN ATA owned by Epoch) |
| `push_payouts` | keeper | `Vec<(Pubkey wallet, u64 amount)>` ≤ 12; each dest must be an **existing** COIN ATA of wallet (no init); sum ≤ total − pushed; emits `Payout` per item |
| `finalize_epoch` | keeper | `merkle_root, merkle_total` for the remainder (`total − pushed`) |
| `claim` | wallet | `amount, proof: Vec<[u8;32]>`; leaf = `keccak(epoch, wallet, amount)`; init Claimed (payer = wallet); create ATA if needed (payer = wallet) |
| `sweep_unclaimed` | admin | after 180 days → treasury |

Events: `EpochOpened{pool, index, total, holders}`, `Payout{pool, epoch, wallet, coin_mint, amount, kind(0 push/1 claim)}`, `EpochFinalized{pool, index, merkle_root, remainder}`.

---

## 4. `buyback`

Seeds: `buyback` (state), vault = buyback_vault[coin] owned by fee_router; buyback program pulls via fee_router CPI `withdraw_for_buyback`.

| ix | signer | notes |
|---|---|---|
| `initialize` | admin | `ice_mint, ice_pool (DAMM v2 ICE/GLD), reserve_buffer_bps=200` |
| `convert_and_burn` | keeper | for coin ≠ GLD: `peg_desk::sell(coin→USDC)` CPI, then `peg_desk::buy(USDC→GLD)` CPI; then `cp_amm::swap(GLD→ICEmarkets)` CPI on ICE/GLD pool; `spl_token::burn`. Bounded per call by `max_per_cycle`. Emits `Buyback{coin, coin_amount, gld_amount, ice_burned}` |
| `set_params` | admin | |

v1.0 scope: `initialize`, `convert_and_burn` for the GLD path only (GLD→ICEmarkets→burn); other coins forwarded via peg_desk sell/buy is backlog, not part of v1.0.

---

## 5. Off-chain contracts

### Launch (client-side, `packages/sdk/src/launch.ts`)
v0 `VersionedTransaction`s compiled against the launch Address Lookup Table (`scripts/create-alt.ts` →
`deployments/<cluster>.json#addressLookupTable`); the builder throws if a tx still exceeds 1232 bytes.
One tx (USDC path): `[ComputeBudget, peg_desk.buy_exact_out(COIN, amountNeeded), dbc.createConfig(keypair), dbc.initializeVirtualPoolWithSplToken, dbc.swap(firstBuy), fee_router.register_pool]`.
Config per launch built with `buildCurveWithTwoSegments({ totalTokenSupply: 1e9, initialMarketCap: 5000/coinUsd, migrationMarketCap: 35000/coinUsd, percentageSupplyOnMigration: 20, migrationOption: 1 /*DAMM v2*/, tokenBaseDecimal: 6, tokenQuoteDecimal: 6, lockedVestingParam: none, baseFeeParams: {feeSchedulerParam:{startingFeeBps: tier, endingFeeBps: tier, numberOfPeriod: 0, totalDuration: 0}}, dynamicFeeEnabled: false, activationType: 1 /*timestamp*/, collectFeeMode: 0 /*quote*/, migrationFeeOption: 6, migrationFee: {feePercentage: 0, creatorFeePercentage: 0}, partnerLpPercentage: 0, partnerLockedLpPercentage: 100, creatorLpPercentage: 0, creatorLockedLpPercentage: 0, creatorTradingFeePercentage: 0, leftover: 0, tokenUpdateAuthority: 1 /*immutable*/, feeClaimer: routerPda, leftoverReceiver: treasury, quoteMint: COIN, enableFirstSwapWithMinFee: true, poolFeeBps: tier })`.
SOL path: tx1 Jupiter SOL→USDC; tx2 as above. Field names must be checked against the pinned SDK version at build time — `launch.ts` wraps them in one adapter function so a rename is a one-line fix.

### Keeper cycles (`apps/keeper`)
`oracle` (Hermes → `pyth_receiver.postUpdate` into per-commodity update accounts, partially verified where allowed; deviation-triggered), `session` (flip Open/Closed by calendar), `fees` (every 900s: fee_router.claim_dbc / claim_damm for pools with unclaimed ≥ $100), `payouts` (TWAB from indexer → open_epoch → push_payouts to existing ATAs → finalize_epoch with Merkle), `migrate` (poll DBC `is_migrated`/curve complete → `migrate_damm_v2` → record_migration), `buyback` (every 900s), `arb` (keep seeded COIN/USDC DAMM pools at peg vs Peg Desk).

### Indexer tables (`apps/indexer/schema.sql`)
`commodities, prices(commodity, ts, price, conf, source)`, `pools(dbc_pool, base_mint, quote_mint, commodity, creator, fee_bps, created_at, migrated_at, damm_pool)`,
`trades(sig, pool, ts, side, base, quote, price_quote, price_usd, trader)`, `candles(pool, tf, ts, o,h,l,c,v)`, `balances(pool, wallet, amount, updated_slot)`,
`balance_events(pool, wallet, delta, slot, ts)` (for TWAB), `epochs, payouts, fee_claims, buybacks`.
v0.2 (additive): `commodity_trades` (peg_desk `Trade`), `fee_splits`, `epoch_progress` (keeper payout plans),
`raw_events`; idempotency keys (`sig` columns + unique indexes); `pools.{base,quote,damm_base,damm_quote}_vault`;
memecoin price columns widened to `numeric(38,18)`.

---

## 6. Implementation notes (v0.1 code vs. this contract)

Recorded after the first build pass so the doc matches the code. These are the deltas; everything else is as specified above.

**peg_desk**
- `reserve_vault` is a PDA token account at `["reserve", commodity]` (authority = commodity PDA), not an ATA.
- `IndexLeg` is a plain Borsh struct (not `zero_copy`); identical bytes.
- `Commodity.pyth_min_signatures: u8` added (taken from `_reserved`, now 63 bytes). 0 = require `VerificationLevel::Full`.
- New admin ix `set_keeper_bounds(max_move_bps, min_interval)`; first `keeper_update_price` creates `KeeperPrice` with defaults 500 bps / 0 s.
- `sell` has no treasury account (spread stays in reserve until `sweep_spread_fees`, which also needs `coin_mint` and values the reserve at `last_price`, which must be within `max_age`).
- New commodities start `Open`. Extra errors/events are appended after the listed ones (codes preserved).
- Program id placeholder is `PegDesk111111111111111111111111111111111111` (43 chars; the 44-char form was not a valid 32-byte key).

**fee_router / distributor / buyback**
- Manual CPI lives in `src/cpi_ext/` (Anchor reserves the `cpi` module name). Discriminators are sha256(`global:<ix>`)[..8] constants checked by `scripts/print-discriminators.ts --check`. Account orders and byte offsets for DBC/DAMM v2 are marked `// VERIFY ORDER vs IDL` / `// VERIFY OFFSET` — must be checked against the IDLs before devnet.
- `RouterConfig` stores `peg_desk_program` (from `_reserved`).
- Extra ixs: fee_router `register_pool_admin`, `withdraw_treasury`, `set_programs`; distributor `set_keepers`, `set_params`.
- `record_migration` is keeper/admin only (prevents junk-position griefing); admin `force` flag skips the `is_migrated` read.
- `push_payouts` takes `Vec<PayoutItem{wallet, amount}>` (IDL-friendly).
- `open_epoch` funds from any `(source_vault, source_authority)`; production passes the router `PoolState[pool]` PDA as authority via `withdraw_for_epoch`.
- `convert_and_burn(gld_is_token_a: bool)`; `reserve_buffer_bps` = share of buyback vault left untouched per cycle.
- New PDA seeds: distributor `dist`, `dist_auth`; buyback `bb_auth`. Router receiving account = router PDA's ATA for the COIN mint. Registry `SEEDS` updated.
- Assumes migrated DAMM v2 pools have token_a = memecoin, token_b = COIN (verify at migration time; `record_migration` stores the order).

**Off-chain (review 2026-09-11, see docs/REVIEW-2026-09-11.md)**
- `packages/sdk/src/pricing.ts` is a verified port of `pricing.rs` (differential test: 20k random vectors, 0 mismatches). `conf_mult_bps` means "bps of spread per 1% of conf/price" (`ceil(conf_mult·conf·100/price)`); spread is clamped to `MAX_SPREAD_BPS = 5000`; the ×2 widening uses the PRE-trade reserve ratio.
- One Merkle implementation: `packages/sdk/src/merkle.ts` (`buildEpochTree`); `tests/merkle.ts` re-exports it; the keeper imports it from `@icemarkets/sdk`.
- Keeper and scripts build ICEmarkets instructions with Anchor `Program<any>` from `target/idl/<name>.json` (read at runtime, `IDL_DIR` override). The browser uses the peg_desk IDL from `/idl/peg_desk.json` (`make idl`) and hand-encoded builders for `fee_router.register_pool` and `distributor.claim` (discriminators checked by `scripts/print-discriminators.ts --check`).
- Registry USD caps are converted to coin base units at seed time with the live price: `cap = floor(usd·10^6·1e8 / price_1e8)`. Tier A (A24/AHours) seeds `pyth_min_signatures = 0` (Full), tiers B/C seed 5.
- Indexer DB units: token amounts `numeric(30,6)` are human units (base/1e6), prices `numeric(20,8)` USD; `prices.commodity`/`pools.commodity` are `commodities.symbol`. Exception: `merkle_leaves.amount` is exact base units. `GET /rewards/:wallet/claims` serves unclaimed leaves + proofs to the web claim flow.
- fee_router vaults are PDA **token accounts** (not ATAs): `holder_vault` = PDA["holder_vault", dbc_pool] (COIN, authority = PoolState PDA), `buyback_vault` = PDA["buyback_vault", coin] and `treasury` = PDA["treasury", mint] (authority = router PDA). Only the router's receiving account is an ATA (`ATA(coin, router PDA)`); the distributor epoch vault is `ATA(coin, Epoch PDA)`.

**Off-chain (v0.2, 2026-09-11 — closes the review's open questions)**
- Indexer ingestion (`apps/indexer/src/decode/*`): Anchor events from logs via `BorshCoder`/`EventParser` with the
  runtime IDLs; DBC/DAMM v2 swaps and memecoin balance deltas from vault / owner token-balance changes (venue-agnostic,
  no Meteora IDL needed). `PoolRegistered` upserts `pools` (ticker/name/uri from the Metaplex metadata account;
  creator = fee payer). Keeper and indexer both write payouts / fee claims / buybacks / prices / epochs; unique keys make
  that safe. `backfill.ts` replays a pool from RPC history.
- Payout epochs are resumable: the share plan is persisted in `epoch_progress` before `open_epoch`; an unfinalized
  on-chain epoch is always finished (push the unpushed, finalize) before `index + 1` is opened. Merkle leaves are sorted
  by wallet so a resumed/repaired tree reproduces the on-chain root. Min-holding filter = TWAB × latest candle close ×
  COIN USD ≥ `PAYOUT_MIN_HOLDING_USD` (skipped with a warning without prices).
- Buyback `min_ice_out` = cp-amm exact-in quote × (1 − 50 bps); skipped when the quote fails or the GLD reserve is
  < 20 × the trade.
- Switchboard-kind commodities are relayed by the keeper through `keeper_update_price` into their KeeperPrice stand-in
  (same sources as the Switchboard jobs) until `switchboard-on-demand` replaces the stand-in in `oracle.rs`.
- USDC = `@icemarkets/registry` `usdcMintFor(SOLANA_CLUSTER, USDC_MINT_OVERRIDE)` everywhere (keeper, scripts, web).
- Composite (index) coins are priced client-side like `read_composite` (weighted legs, oldest publish time) and their
  leg accounts are appended automatically to buy / buy_exact_out / sell, so the launch builder treats them as any coin.
- `@icemarkets/registry` resolves to `src/` by default and to `dist/` under the `icemarkets-dist` export condition
  (`node --conditions=icemarkets-dist`, used by the compiled indexer).

