# Build status — 12 Sep 2026 (v0.6: LOCALNET LOOP PROVEN END TO END)

**v0.6 (12 Sep 2026, evening).** `make localnet` brings up the whole stack on a local validator with the mainnet Meteora DBC,
DAMM v2, Pyth and Metaplex programs cloned (`scripts/localnet-up.sh`), and the money path is proven on the breaker-enabled
programs: CLI launch → three funded payout epochs (claim_dbc → 50/25/25 split → open_epoch via the fee_router CPI → push →
finalize) → forced migration on a $300-cap market (curve completion → migrate_damm_v2 → record_migration) → claim_damm from
the router-owned DAMM position → a payout epoch on the migrated pool. Tier breakers applied to all 75 coins; 60 keeper-relayed
coins post; `anchor test` **49/49** (fee_router, buyback and breaker suites included). 72 h soak running under `.localnet-logs/`.

Bugs the loop found (all fixed, head c6b2276+): launch tx overruns the 10 KB log limit so `PoolRegistered` never reached the
indexer (indexer now reconciles from `PoolState`; durable fix `emit_cpi!` → audit-freeze list); SDK `getPool` wraps the account
in `{ poolState }` so the keeper read zero unclaimed fees; `migrate.ts` waited on a non-existent `curveComplete` (now
`migrationProgress`); keeper relays stamped with wall time while the validator clock lags (now chain time — would also bite a
lagging mainnet RPC); DBC exact-in swap rejects buys above remaining curve capacity (now `swap2` partial fill); SDK-prepended
ComputeBudget ixs collided with ours; keeper was never registered on distributor/fee_router (`init-programs` does it).
`claim_damm` now thresholds on the position's unclaimed COIN fee (`FEE_MIN_CLAIM_USD`).

Still open: buyback (needs $ICE mint + ICE/GLD DAMM pool + `buyback.initialize`); devnet re-run once funded (Helius airdrops)
with `make init-programs` (KEEPER_PUBKEYS) and `PYTH_API_KEY`; hosting live on Vercel Pro / Fly / Neon / Helius (`deploy/README.md`).

*(previous header)* # Build status — 12 Sep 2026 (v0.5: FIRST DEVNET MARKET + HARDENING PASS 1)

**v0.5 (12 Sep 2026).** First market launched end to end on devnet: `$BG` / BURGER, tx `5Ye5tS73…CPon` — one transaction
running `peg_desk.buy_exact_out` → `DBC initialize_virtual_pool` (+ Metaplex metadata) → creator first swap →
`fee_router.register_pool`. Fixes that made it work (tag `devnet-first-launch`): SDK Associated Token Program constant was a
mistyped address (broke every ATA derivation); fee_router / distributor configs were never initialised (`make init-programs`);
launch split into two transactions with per-tx signers and a resumable half-completed state; curve leftover 100k tokens so
Meteora's builder rounding fits; combined config-and-pool builder; empty `NEXT_PUBLIC_TREASURY` / `data:` image URIs handled.
Still open from that run: indexer not running (keeper fee cycle won't see `$BG`), `make alt` must be re-run (old ATAs in the
table), orphan DBC config `4Nmk…` (~0.01 SOL), balances near zero (wallet 0.014, admin 0.028, keeper ~0.09 SOL).

**Hardening pass 1 (MAINNET_PLAN §2, uncompiled in the cloud — run `anchor test` + `pnpm --filter @icemarkets/sdk test` on the Mac):**
| What | Where |
|---|---|
| peg_desk circuit breakers: daily mint / redeem caps (24 h window), price-deviation bound vs last accepted price (any oracle), admin `clear_price_anchor` | `programs/peg_desk/src/{state,constants,errors,pricing}.rs`, `instructions/{trade,commodity}.rs`; CONTRACTS §6 |
| Per-tier defaults + apply script | `packages/registry/src/risk.ts`, `scripts/set-breakers.ts`, `make breakers` |
| SDK: `setCommodityParamsIx`, `clearPriceAnchorIx`, `CommodityAccountView.breakers` | `packages/sdk/src/pegDesk.ts` |
| Rust unit tests: deviation / window math (6), fee split rounding (4) | `pricing.rs`, `fee_router/src/instructions/common.rs` (`split_amounts` extracted) |
| Localnet: 5 new peg_desk breaker cases; new `fee_router` suite (16: split/keepers/pause, every `register_pool` negative path via hand-built DBC fixtures, PDA-signer-only vault withdrawals, treasury, admin rotation); new `buyback` suite (4) | `tests/{peg_desk,fee_router,buyback}.test.ts`, `tests/fixtures/` (`gen_fixtures.py`, deterministic; wired in `Anchor.toml`) |
| SDK: every PDA/ATA derivation pinned to independently computed vectors + differential test vs spl-token (complements the devnet-fixture `pda.test.ts` added on the Mac) | `packages/sdk/src/pdaVectors.test.ts` |
| SDK: Meteora CPI discriminators, account order/flags/args and raw offsets pinned to the installed `@meteora-ag` SDK IDLs (DBC 0.2.1, cp-amm 0.2.4) | `packages/sdk/src/meteoraLayout.test.ts` — found the unused `migrate_damm_v2` constant was derived from the wrong name (real ix: `migration_damm_v2`); fixed |
| CI: cargo test + SDK tests + typecheck; `anchor test` on a local validator; nightly devnet smoke | `.github/workflows/ci.yml`, `scripts/devnet-smoke.ts` (`make smoke`; `SMOKE_TRADE=1` adds a 1 USDC round-trip) |

After `anchor build` on the Mac: `make breakers` (DRY_RUN=1 first) applies the tier defaults to the 50 seeded devnet coins.

**v0.3.** Product decision: there are no more MVP/v1.1/v2 release phases — everything in this doc and in `docs/ICEMARKETS_SPEC.md` §5 ships in one release. Added the **watches** category (10 coins — SUBMARINER, DAYTONA, GMTMASTER, DATEJUST, ROYALOAK, NAUTILUS, SPEEDMSTR, SANTOS, GSHOCK, TISSOTPRX) and the **WATCHX** index coin to `packages/registry/src/commodities.ts`, relayed like the CS2/TCG coins via `relaySwitchboardPrices` (`watch_*_median3` jobs → `sources/watches.ts` WatchCharts + a Chrono24 stub, `switchboard/jobs/watch-median.json`), with `data/manual-prices.json` seed prices as a bootstrap fallback when fewer than 2 live sources respond. Added **Collector Crypt** (`sources/collectorcrypt.ts`) as an additional price source — a third leg for both `watch_*` and `tcg_*` Switchboard relays via the new `sources/median.ts` `median3` helper (drops nulls, requires ≥2, rejects >25% outliers). Registry is now 93 commodities + 3 index coins (PMX, WATCHX, CS2X).


## ✅ Verified on a real toolchain (11 Sep 2026, Yashish's Mac — Agave 4.2.2, Anchor 0.31.1, platform-tools bundled)
| What | Result |
|---|---|
| `anchor build` — all 4 programs | ✅ compiles; only harmless `AccountInfo::realloc` deprecation warnings from Anchor's macro |
| Program ids | real keypairs in `target/deploy`, synced into `declare_id!` and both `[programs.*]` tables: peg_desk `6jMv6pdi…rqQN`, fee_router `9bnCKVes…rbEt`, distributor `AEGw9dc3…4dV6`, buyback `2jsn1m1E…k4Lk` |
| Meteora CPIs vs **mainnet-deployed IDLs** (`anchor idl fetch` → `vendor/idl/`) | ✅ all 11 Rust + 2 SDK discriminators match; account order + writable flags for `claim_trading_fee`, `partner_withdraw_surplus`, `claim_position_fee`, `swap` match exactly; every byte offset in `fee_router/src/constants.rs` matches struct layouts (incl. `is_migrated@305`) |
| `pnpm typecheck` — 5 workspaces | ✅ clean (dbc.ts rewritten against `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12 real types) |
| SDK unit tests | ✅ 44/44 |
| `anchor test` — local validator with cloned Meteora DBC, DAMM v2, Pyth receiver, Metaplex | ✅ **25/25** (peg_desk + distributor suites) |
| SDK ↔ IDL cross-check (`scripts/check-sdk-vs-idl.ts`) | ✅ 32 files, 0 mismatches (after 1 fix) |

Fixes the compiler forced (all committed): Solana 2.1 → Agave 4.2.2 pinned in `Anchor.toml` (avm re-activates 2.1.0 when `solana_version` is unset); `Cargo.lock` committed with `anchor-lang@0.31.1` / `solana-program@2.3.0` precise pins (Pyth SDK has open-ended bounds); DBC SDK params are nested (`token`, `fee`, `migration`, `liquidityDistribution`, `lockedVesting`), `createPoolWithFirstBuy` lives on the creator service, `migrateToDammV2` needs a `dammConfig` and returns two position-NFT keypairs that must sign (keeper migrate cycle updated); chai 4 has no bigint comparators (`expectBig` helper); Backpack adapter removed upstream (Wallet Standard auto-detects); `[test.validator] bind_address = "127.0.0.1"` (Agave 4.x panics on 0.0.0.0); distributor direct-mode test flips `source_authority` signer meta.

**Open decision:** `poolCreationFee: 0` in the launch config (SDK accepts it). Keep 0 (creators pay only rent + first buy) or set e.g. 0.01 SOL as a spam deterrent (Meteora takes 10% of it)?

## Verified offline (pre-toolchain, superseded by the table above)
| What | How | Result |
|---|---|---|
| `peg_desk/src/pricing.rs` | `rustc --test` standalone | 21/21 pass |
| Rust ↔ TS pricing parity | 20,000 random vectors from pricing.rs replayed through `packages/sdk/src/pricing.ts` | 0 mismatches |
| SDK unit tests | pricing 24, merkle 8, twab | pass (mocha/chai shim) |
| Keccak / Merkle | standard vectors; SDK tree == tests/merkle.ts tree for 1–39 leaves | pass |
| Registry | `tsx packages/registry/src/validate.ts` + on-chain symbol/param rules | 83 commodities + 2 index coins OK (pre-v0.3; now 93 + 3 with watches/WATCHX — re-run `validate.ts` once the toolchain is available) |
| Anchor discriminators | `tsx scripts/print-discriminators.ts --check` | all OK |
| Program id placeholders | base58 → 32 bytes | OK (PegDesk id fixed to 43 chars) |
| rustfmt | `cargo fmt --check` | clean |
| TypeScript | `tsc` over sdk/registry/keeper/scripts/indexer/web lib | only missing-package errors |
| TypeScript (v0.2) | `tsc` (TS 6) over sdk/registry/keeper/indexer/scripts + the changed web pages/components, with hand-written ambient stubs for `pg`, `@solana/web3.js`, `@coral-xyz/anchor`, `@solana/spl-token`, React/Next hooks | 0 errors besides implicit-any params of stubbed callbacks (Fastify handlers, JSX event handlers) |
| Indexer decoders (v0.2) | scratch tests: DBC buy/sell/init+first-buy/migration/transfer, DAMM swap, failed tx; Helius enhanced (+`tokenTransfers` fallback), raw RPC (+ALT-loaded keys), jsonParsed diffing; Anchor event typing (snake/camel fields, name casing, BN/PublicKey-likes); Metaplex metadata decode | pass |
| Web session calendar (v0.2) | `apps/web/lib/session.ts` vs keeper `session.ts`, every 15 min of 2026 × 5 session kinds; next-open for Fri close / daily break | 175,680 samples identical |
| USDC per cluster (v0.2) | `usdcMintFor` / `parseCluster` | pass |

## NOT yet verified (needs devnet / live services)
- `next build` (typecheck passes; production build not run yet).
- Live-service `// CHECK`s: Pyth receiver method names (`apps/keeper/src/cycles/oracle.ts`), Jupiter API shape, Helius payload fields,
  cp-amm quote, Collector Crypt / WatchCharts / Pricempire API shapes.
  Still marked from v0.2: cp-amm `fetchPoolState`/`getQuote` (`packages/sdk/src/damm.ts`), Anchor `BorshCoder`/`EventParser`
  (`apps/indexer/src/decode/anchorEvents.ts`), Helius enhanced payload fields (`apps/indexer/src/decode/types.ts`),
  DBC/DAMM `token_vault` seeds (`apps/indexer/src/decode/meteora.ts`, same as `sdk/meteora.ts`).
- Launch tx size with the ALT (`buildLaunchTransactions` asserts ≤ 1232 bytes at build time — first real run tells).

## First-compile checklist (in order)
1. `make bootstrap` → `make build`. Needs Agave CLI stable (3.x): Solana 2.1 bundles cargo 1.79, which cannot parse edition-2024 crates, and its cargo-build-sbf cannot drive newer platform tools. Fix compile errors program by program: peg_desk → fee_router → distributor → buyback.
2. `cargo tree -i anchor-lang` — ensure `pyth-solana-receiver-sdk` resolves to one anchor-lang version.
3. `anchor keys sync` → `make idl`.
4. Download IDLs: `curl https://raw.githubusercontent.com/MeteoraAg/dynamic-bonding-curve/main/idls/dynamic_bonding_curve.json` and DAMM v2 `cp_amm.json`; run `tsx scripts/print-discriminators.ts <dbc.json> <cp_amm.json>` to diff account orders; fix `cpi_ext/*.rs` and `fee_router/src/constants.rs` offsets.
5. `pnpm install`; fix `dbc.ts` against the installed `@meteora-ag/dynamic-bonding-curve-sdk` types; `pnpm typecheck`.
6. `anchor test` (peg_desk + distributor suites).
7. Devnet: deploy, seed GLD/SLV/HG with Pyth 24/7 feeds, `make alt` (launch lookup table), apply `apps/indexer/schema.sql`,
   start the indexer webhook (+ `backfill.ts` for existing pools), run the keeper, launch a test market from the UI.

## Closed in v0.2
1. **Switchboard coins relayed** — `apps/keeper/src/cycles/oracle.ts` `relaySwitchboardPrices`: CS2 (median of 3) and
   TCG sources → `keeper_update_price` into the KeeperPrice stand-in (every ≥ 5 min, bounded on-chain). `// TODO switchboard-on-demand`.
2. **Payout min-holding filter** — TWAB × latest candle close (memecoin in COIN) × COIN USD from `prices` ≥
   `PAYOUT_MIN_HOLDING_USD`; skipped with a warning when either price is missing.
3. **Epoch resume** — the keeper loads the latest on-chain `Epoch`; if unfinalized it resumes (plan from `epoch_progress`,
   pushed set from `payouts` reconciled with on-chain `Payout` events, push the rest, finalize) before opening a new one;
   a finalized epoch with missing bookkeeping is repaired (tree rebuilt, root checked). New table `epoch_progress`.
4. **Buyback `min_ice_out`** — cp-amm exact-in quote × (1 − 50 bps) (`BUYBACK_SLIPPAGE_BPS`); skip when the quote fails
   or the GLD reserve < 20 × trade (`BUYBACK_MIN_LIQUIDITY_MULT`). `BUYBACK_MIN_ICE_OUT` removed.
5. **Indexer ingestion** — `apps/indexer/src/decode/*`: Anchor events (peg_desk / fee_router / distributor / buyback) from
   logs with runtime IDLs; DBC + DAMM v2 swaps → `trades`; memecoin balance changes → `balance_events`/`balances`;
   `PoolRegistered` → `pools` (ticker/name/uri from Metaplex metadata); `src/backfill.ts`. Schema changes are additive
   (+ lossless widening of memecoin price columns to `numeric(38,18)` — they rounded to 0 before).
6. **USDC per cluster** — `usdcMintFor(SOLANA_CLUSTER, USDC_MINT_OVERRIDE)` in keeper config, scripts and web
   (`apps/web/lib/cluster.ts`; next.config inlines the root `.env`). The keeper refuses a stale v0.1 `USDC_MINT` that
   disagrees with the cluster.
7. **Launch tx size** — v0 `VersionedTransaction`s + `scripts/create-alt.ts` (static programs/PDAs/commodity accounts →
   `deployments/<cluster>.json#addressLookupTable`, `make alt` publishes it to the web); the builder asserts ≤ 1232 bytes.
Also closed from docs/REVIEW-2026-09-11.md "Open questions":
- R5 **Index coins** — SDK prices Composite coins like `read_composite` and appends leg accounts to trades; `/commodities`
  shows an "Index coins" section (no version badge — there are no release phases), `/launch` lists them under an "Index coins" filter.
- R6 **pools.ticker/name** — set by the webhook from the Metaplex metadata account at `PoolRegistered` (fallback: mint prefix).
- R7 **Closed markets in the UI** — Buy tab disabled with "Market closed — sell-only until the session opens in …"
  (`apps/web/lib/session.ts`), defaults to Sell; memecoins can still be bought with the coin itself (new SDK
  `buildBuyWithCoin`). Halted disables both sides with a feed-recovering banner.
- R9 **Registry build order** — `@icemarkets/registry` resolves to `src/` (tsx/Next, no prebuild) and to `dist/` under the
  `icemarkets-dist` export condition (`node --conditions=icemarkets-dist`; the indexer's `build`/`start` do this).

## Closed in v0.3
1. **No release phases** — `docs/ICEMARKETS_SPEC.md` §5 collapsed the MVP/v1.1/v2 scope table into one "v1.0 (single
   release)" column; the web app's "v1.1" badges (index coins, the Launch wizard's basket toggle) are gone.
2. **Watches category** — 10 coins + `WATCHX` index coin in `packages/registry/src/commodities.ts`; `/commodities` and
   the Launch wizard's category chips now include "Watches" (⌚); `apps/web/lib/mock.ts` seeds their prices.
3. **Watch oracle sourcing** — `apps/keeper/src/sources/watches.ts` (WatchCharts, keyed by `WATCHCHARTS_API_KEY`;
   Chrono24 as a documented scrape-disabled stub) and `apps/keeper/src/sources/collectorcrypt.ts` (Collector Crypt —
   Helius DAS `getAssetsByGroup` + Enhanced Transactions `NFT_SALE` events as the primary, on-chain-verifiable path;
   an optional REST API fallback via `COLLECTORCRYPT_API_URL`). Combined by the new `apps/keeper/src/sources/median.ts`
   `median3` helper (≥2 of 3, drops >25% outliers) in `relaySwitchboardPrices`'s new `watch_*` case.
4. **Collector Crypt as a trading-card source too** — `trading_cards`' `relaySwitchboardPrices` case now runs
   `median3(pokemontcg, collectorcrypt)` instead of pokemontcg.io alone (falls back to the lone pokemontcg reading if
   Collector Crypt doesn't respond, since there's no manual-price seed for cards).
5. **Manual-price bootstrap for watches** — `data/manual-prices.json` gained 10 `"source": "seed-estimate"` entries; the
   relay uses one only when live sources return fewer than 2 values, and posts it with a wider confidence band
   (`MANUAL_FALLBACK_CONF_BPS`, 5%) than a normal single-source relay.
6. **`switchboard/jobs/watch-median.json`** — mirrors the existing `cs2-median.json` / `tcg-market.json` job shape.

## Still open
- **Memecoin transfer coverage**: TWAB is only as complete as `balance_events`. Plain SPL `transfer`s do not list the
  mint; confirm Helius delivers them for a watched mint address, or run `backfill.ts` per pool on a schedule.
- **Post-migration memecoin trading from the web**: the SDK trade builders only swap on the DBC curve; DAMM v2 pools are
  indexed but not tradable in the UI yet. DBC-leg `minimumAmountOut` is still 0 (existing CHECK in `trade.ts`).
- **Switchboard futures** (RB/HO/LBR/ZM/ZL/ZR/ZO/CT/OJ/DC/GF/HE) need a licensed vendor feed; the relay skips them.
  RSGP's source (`sources/osrs.ts`) is still a stub.
- **Epochs opened by the v0.1 keeper** have no persisted plan; resume recomputes it from the epoch's window. If late
  `balance_events` changed the split, finalize can fail `merkle_total ≤ remainder` → logged in `epoch_progress.last_error`
  for manual review.
- Existing v0.1 databases with duplicate `payouts` / `prices` rows must be deduped before the new unique indexes build.
- The launch ALT's authority is the admin key; freeze it (or move it to the Squads vault) before mainnet.

## Backlog (no phase — future work, not part of v1.0)
- Index coins (PMX, WATCHX, CS2X): seed on devnet (`create-index-coin.ts`) and test the Composite trade path end-to-end.
- Watch/card oracle sourcing: `sources/watches.ts` (WatchCharts) and `sources/collectorcrypt.ts` (Helius DAS / REST) are both `// CHECK` — neither has been exercised against a live response (no network in this sandbox); confirm endpoint shapes and get a WatchCharts API agreement + Collector Crypt collection address before relying on them over the manual-prices.json seed. Chrono24 stays a scrape-disabled stub pending a compliant sourcing path.
- Jupiter AMM integration for the Peg Desk; seeded COIN/USDC DAMM v2 pools + keeper arb.
- Tokenize-anything (TCGplayer catalogue).
- Telegram/X bot via Solana Agent Kit (launch/quote by chat).
- Hedge vault rebalancing (PAXG/XAUt0 for GLD).
