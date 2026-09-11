# 05: Independent verification of ICEMARKETS_SPEC.md's load-bearing claims

**Reviewer:** skeptical Solana protocol review, 11 Sep 2026.

**Method.** I read the code directly rather than trusting summaries:
- `MeteoraAg/dynamic-bonding-curve` @ `f552f20` (Release 0.2.1, 9 Sep 2026)
- `MeteoraAg/dynamic-bonding-curve-sdk` @ `aa1595c` (package 1.5.12, 7 Sep 2026)
- `MeteoraAg/damm-v2` @ `a85c926` (Release 0.2.4, 8 Sep 2026)

I also checked the Meteora, Jupiter, Pyth (Hermes) and Solana docs.

**Limits.** Some things could not be checked:
- npm and Solana mainnet RPC were blocked by the sandbox, so I could not run the SDK or read on-chain accounts.
- Hermes `/v2/updates` was blocked. The feed-list endpoints did work.
- The curve numbers below come from a Python port of the SDK formulas (`getPercentageSupplyOnMigration`, `getTwoCurve`).

Code paths below are relative to `programs/dynamic-bonding-curve/src/` unless marked otherwise.

---

## Headline findings (read these first)

1. **The spec's `buildCurveWithMarketCap` call is wrong, and "80% on curve / 20% migrated" at $5k to $35k can't be built with that function.**
   - The function has no `percentageSupplyOnMigration` parameter. It works that value out from the two market caps.
   - A single constant-product segment from $5k to $35k gives **27.4% migrated / 72.6% on curve**, with a threshold of about $9.6k in COIN.
   - To get 80/20, use **`buildCurveWithTwoSegments`**, which takes `initialMarketCap`, `migrationMarketCap` and `percentageSupplyOnMigration`. I checked that it solves for 5k→35k at 20% (threshold about $7k in COIN).
2. **Routing the launch through `launch_router` by CPI would take away the creator's cheap first buy.**
   - DBC only charges a first swap the minimum fee (`enable_first_swap_with_min_fee`) when that swap is a **top-level** DBC instruction *and* an earlier top-level DBC `initialize_virtual_pool_*` for the same pool is in the same transaction (`validate_contain_initialize_pool_ix_and_no_cpi`, `instructions/swap/process_swap.rs:501`).
   - Run through a CPI router, the creator's first buy would pay the anti-sniper starting fee (25% in §3.2).
   - Build launches as a sequence of top-level instructions, not nested CPIs.
3. **The fee tier after graduation doesn't match the creator's tier.**
   - `migrationFeeOption = 3` fixes every migrated DAMM v2 pool at a **2%** fee, whatever tier (1/2/3%) the creator picked.
   - With the fixed options, the fee-collection mode after migration also comes from Meteora's static DAMM v2 config, not from DBC. DBC doesn't check it in `validate_config_key`.
   - Use **`migrationFeeOption = 6` (Customizable)** with `migratedPoolFee = { collectFeeMode: 0 (quote only), poolFeeBps: 100/200/300 }` (allowed range 10–1000 bps). This keeps post-graduation fees in COIN and at the creator's tier.
4. **There is no 24/7 WTI feed on Pyth.**
   - The 24/7 energy feeds are `Commodities.Index.PYTHOIL` (Pyth's own oil blend), `BRENT` and `NATGAS`. WTI exists only as dated futures and as `WTI1M`, which is constant-maturity and trades 23/5.
   - Either relabel the CL coin as "OIL (Pyth blend)" or move WTI to Tier A-hours.
5. **The holder-payout cost model gets the size of costs wrong.**
   - It overstates transaction fees by about 3–5× at realistic SOL prices.
   - It leaves out the biggest cost: rent for the COIN token account (ATA) of each new recipient, about 0.00204 SOL each. That rent belongs to the user and **cannot be recovered** by the protocol.
6. **`fee_claimer` can never be changed after a config is created.** DBC has no instruction to update it.
   - If `fee_router` is frozen or has a bug, every DBC fee and every post-graduation LP position is stuck with it.
   - Keep `fee_router` upgradeable behind the Squads multisig with a timelock, and say this in the spec.

---

## Verification table

| # | Claim (spec §) | Verdict | Evidence | Correction |
|---|---|---|---|---|
| 1a | DBC accepts any classic SPL mint as `quote_mint` without permission (D1, §4) | **CONFIRMED** | [`utils/token.rs#is_supported_quote_mint`](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/main/programs/dynamic-bonding-curve/src/utils/token.rs): returns true straight away if the mint is owned by the classic Token program. Token-2022 mints may carry only MetadataPointer/TokenMetadata and must have zero transfer fee; anything else needs a `TokenBadge` created by an operator. | None. COIN mints must stay **classic SPL**. |
| 1b | A partner needs no whitelisting to create a config | **CONFIRMED** | [`create_config/ix_create_config.rs`](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/main/programs/dynamic-bonding-curve/src/instructions/partner/create_config/ix_create_config.rs): `create_config` has no `access_control`. The only signers are `payer` and the new `config` keypair. `fee_claimer` and `leftover_receiver` are unchecked. | Note that `config` is a **fresh keypair that must sign, not a PDA**. The config factory has to generate and keep these keys, or create them via a PDA signer. |
| 1c | Cost of creating a config (not stated in the spec) | **ADD** | `PoolConfig::INIT_SPACE = 1040` + 8-byte discriminator = 1,048 bytes, so rent is **0.00819 SOL** plus the transaction fee. Meteora charges no fee for creating a config. There is **no close-config instruction**, so the rent is never returned. The optional `pool_creation_fee` (0.001–100 SOL, Meteora keeps 10%) is charged to *pool* creators. | Configs are cheap: 94 coins × 3 tiers ≈ 2.3 SOL. See 3d for why you may want one config per launch. |
| 2a | `collectFeeMode = 0` collects fees in quote (D4, §3.2) | **CONFIRMED for the curve phase; PARTIAL after graduation** | `state/virtual_pool.rs` `CollectFeeMode { QuoteToken=0, OutputToken=1 }`. After migration, DBC `QuoteToken` maps to DAMM v2 `OnlyB` **only when `migrationFeeOption = Customizable`** (`migration_handler/mod.rs`, `migrate_damm_v2_initialize_pool.rs:150-165`). With the fixed options 0–5, the DAMM v2 static config supplied at migration decides the mode. | Use option 6 with `migratedPoolFee.collectFeeMode = 0`. |
| 2b | Protocol fee is a fixed 20% of the trading fee | **CONFIRMED** | `constants.rs` `PROTOCOL_FEE_PERCENT = 20`. Referral (host) fee is 20% *of the protocol share*, so it comes out of Meteora's cut (`state/config.rs#get_fee_on_amount`). [Fees overview](https://docs.meteora.ag/core-products/dbc/fees/overview.md). DAMM v2 customizable pools also use `PROTOCOL_FEE_PERCENT = 20` (`damm-v2/.../params/fee_parameters.rs`). | None. The 40/20/20/20 arithmetic holds. |
| 2c | `fee_claimer` can be a PDA and claim at any time | **CONFIRMED, with a caveat** | `claim_trading_fee` checks only `config.fee_claimer == signer` (`access_control.rs#is_partner_fee_claimer`, `ix_claim_partner_trading_fee.rs`). There is no cooldown or time gate, and a PDA can sign by CPI. **There is no instruction to update `fee_claimer`.** | Keep `fee_router` upgradeable (Squads + timelock). Also claim `partner_withdraw_surplus` (80% of the over-threshold surplus is split between partner and creator), `claim_partner_pool_creation_fee` and `withdraw_migration_fee`. Pass `max_base_amount = 0` so no base-token account is needed. |
| 2d | `creatorTradingFeePercentage` can be 0 | **CONFIRMED** | `require!(creator_trading_fee_percentage <= 100)`. `split_partner_and_creator_fee` returns early at 0, so 100% goes to the partner. | None. |
| 3a | `buildCurveWithMarketCap({initialMarketCap, migrationMarketCap, totalTokenSupply, percentageSupplyOnMigration: 20})` (§3.2) | **WRONG (signature)** | SDK [`helpers/buildCurve.ts:273`](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/src/helpers/buildCurve.ts). `BuildCurveWithMarketCapParams = BuildCurveBaseParams & { initialMarketCap, migrationMarketCap }` (`types.ts:377`). `totalTokenSupply` sits inside `token: TokenConfig`. `percentageSupplyOnMigration` is **derived** (`getPercentageSupplyOnMigration`, `common.ts:788`): x = 100·√r / (1+√r), where r = initialMC / migrationMC. | Use `buildCurveWithTwoSegments({ token, fee, migration, liquidityDistribution, lockedVesting, activationType, initialMarketCap, migrationMarketCap, percentageSupplyOnMigration: 20 })`. |
| 3b | "80% on curve / 20% to DAMM v2", the same 800M/200M shape as V6 | **WRONG as specified; expressible another way** | Single segment from $5k to $35k gives **27.43% migrated / 72.57% curve**. A single segment with 20% needs either $2,187.5→$35k or $5k→$80k. `buildCurveWithTwoSegments` at 5k→35k with 20% solves (the `mid3` breakpoint, about $8.1k MC) with positive liquidity on both segments. The constraint behind this: DAMM v2 migrates **full-range constant-product liquidity**, so the migrated base amount = quote raised ÷ migration price. It is not a free choice, unlike V6's single-sided "reserve range". | Specify the two-segment builder. Recompute the curve and check it in a devnet config before claiming parity. Note that the migrated 20% is full-range liquidity, not an above-cap single-sided range, so it is not "no cliff" in V6's sense. |
| 3c | Is `migrationQuoteThreshold` a function of these parameters? | **CONFIRMED (yes)** | `migrationQuoteAmount = migrationMC × pct/100`, and `threshold = amount / (1 − migrationFee%)` (`getMigrationQuoteAmount`, `getMigrationQuoteThresholdFromMigrationQuoteAmount`). For 20% at $35k, that is about **$7k worth of COIN**, which is also roughly the TVL of the DAMM v2 pool after graduation (about $14k including base). | Say this explicitly, and say how thin the pool will be after graduation. |
| 3d | One config per (coin × tier), "created lazily"; the curve spans $5k→$35k | **PARTIAL** | Market caps are converted to COIN units when the config is created and then fixed. Every later pool on that config inherits the old COIN/USD rate. For volatile coins (skins, cards, NG) the USD range drifts. | Create a config per launch (0.0082 SOL, a one-off cost), or rotate configs when COIN/USD moves more than about 5–10%. |
| 4a | Migration to DAMM v2 is permissionless | **CONFIRMED** | `MigrateDammV2Ctx` signers are `payer` plus fresh position-NFT mint keypairs. It requires `is_curve_complete` and `migration_progress == LockedVesting` (if there is locked vesting, `create_locker` must run first, and it is also permissionless). A DAMM v2 config must be passed as remaining account 0. | None. Budget the rent the migrator pays for the new DAMM v2 accounts (see 9). Trading stops between curve completion and migration (`PoolIsCompleted`), so the keeper has to be fast. |
| 4b | "Meteora only auto-migrates SOL/USDC/JUP quotes" (§3.2) | **PARTIAL** | [DBC integration intro](https://docs.meteora.ag/developer-guide/integrations/dbc/1-introduction): keeper 1 migrates at 10 SOL / 750 USDC / 1500 JUP. Keeper 2 migrates any pool whose quote is worth **≥ 750 USD**. Whether keeper 2 can price COIN is unknown. | Keep our own keeper, but expect a possible race with Meteora's keeper. That is harmless. |
| 4c | LP 100% partner, permanently locked | **CONFIRMED** | The LP percentages must sum to 100 (`process_create_config.rs`), with at least 10% locked at day 1 (`MIN_LOCKED_LIQUIDITY_BPS = 1000`). `partner_permanent_locked_liquidity_percentage = 100` satisfies both. The first position NFT is sent to `config.fee_claimer` (`migrate_damm_v2_initialize_pool.rs`). | None. Note: anyone can add liquidity to the DAMM v2 pool, which dilutes the router's share of LP fees. |
| 4d | Fees can still be claimed from a locked position | **CONFIRMED** | [`damm-v2/.../ix_claim_position_fee.rs`](https://github.com/MeteoraAg/damm-v2/blob/main/programs/cp-amm/src/instructions/ix_claim_position_fee.rs) has no lock check, only NFT owner or delegate. DAMM v2 0.2.4 adds delegates with `ClaimPositionFee` / `ClaimPositionFeeToOwner` permissions. | Consider a keeper hot key as a `ClaimPositionFeeToOwner` delegate, which reduces CPI surface. |
| 5a | Base fee flat 1/2/3%; min 0.25%, max 99% | **CONFIRMED** | `constants.rs` `MIN_FEE_BPS = 25`, `MAX_FEE_BPS = 9900`. The fee scheduler checks min ≥ 0.25% and max ≤ 99%. The rate-limiter mode is deprecated (`DeprecatedBaseFeeMode`). An anti-sniper decay from 25% to the tier over 60 s works with `activation_type = timestamp`. | Keep the dynamic fee **off**, or tiers aren't flat (it can add up to 20% of the base fee). |
| 5b | Per-pool or per-config fee? | **Per config only (spec design correct)** | `initialize_virtual_pool_with_spl_token` takes only `{name, symbol, uri}`. All fee settings live in `PoolConfig`. | Already handled by one config per tier. Add `enable_first_swap_with_min_fee = true` so the creator's first buy skips the sniper fee (it needs top-level instructions, see 8). |
| 5c | Post-graduation fee "flat at the tier" with `migrationFeeOption = 2% (option 3)` | **WRONG (inconsistent)** | `MigrationFeeOption`: 0 = 0.25%, 1 = 0.30%, 2 = 1%, 3 = 2%, 4 = 4%, 5 = 6%, 6 = Customizable (`state/config.rs:459`). Customizable allows 10–1000 bps (`MIN/MAX_MIGRATED_POOL_FEE_BPS`). | Use option 6 with `poolFeeBps` equal to the tier, and `migratedPoolBaseFeeMode` as a time scheduler with no schedule (flat). |
| 6a | Jupiter auto-lists new DBC and DAMM v2 markets | **CONFIRMED** | [Jupiter market listing](https://developers.jup.ag/docs/swap/routing/market-listing.md) lists "Meteora Dynamic Bonding Curve … Meteora DAMM V2" as instant. A bonding curve must graduate within its grace period (token age under about 30 days) or it is dropped. | None. |
| 6b | Liquidity test: a $500 round trip | **CONFIRMED** | A $500 buy followed by a sell must lose less than 30%. The fallback test compares a $1,000 buy against a $500 buy and requires under 20% price impact. | Caveat [U]: to size a $500 test, Jupiter has to price COIN in USD, which needs a routable COIN/USDC market. Integrators that use `restrictIntermediateTokens` will not route SOL → COIN → MEME through a thin COIN. The seeded COIN/USDC pools are **required for MVP routing**, not optional v1.1 work. |
| 7a | Pyth 24/7 feeds for gold, silver, Brent, natgas, copper | **CONFIRMED** | [Hermes metal](https://hermes.pyth.network/v2/price_feeds?asset_type=metal): `Metal.Index.GOLD/USD` (fa0f…6b01) and `Metal.Index.SILVER/USD` (6afc…52d3) are 24/7. [Hermes commodities](https://hermes.pyth.network/v2/price_feeds?asset_type=commodities): `Index.BRENT` (f33c…fda6), `Index.NATGAS` (45f9…f71c) and `Index.CU` (b2b2…8c59) are 24/7. | None. |
| 7b | 24/7 **WTI** / "oil" | **WRONG for WTI** | No WTI 24/7 feed exists. `Commodities.Index.PYTHOIL/USD` (6778…ef14) is "PYTHOIL 24/7", Pyth's own blend. `Index.WTI1M`, `BRENT1M`, `HHGAS1M` and `TGAS1M` are constant-maturity **23/5** feeds. `Metal.Index.1OZGOLD` is labelled 24/7 but its schedule is Chicago hours on weekdays plus Saturday. | Rename the CL coin to "OIL (Pyth blend)" or put WTI in Tier A-hours. **Use the constant-1M feeds (WTI1M/BRENT1M/HHGAS1M) instead of keeper roll-blending of dated futures for energy**: it removes the roll state machine for those coins. |
| 8 | One transaction: Jupiter swap → custom-program CPI → DBC initialize + swap, "fits in 1.4M CU with ALT" (§3.1E, §3.3) | **PARTIAL (not as designed)** | CU is not the constraint (my estimate: 0.4–0.7M CU). The real limits are: (i) **64 account locks per transaction**; (ii) **1,232 bytes** for legacy/v0 transactions; (iii) Jupiter's docs say CPI into Jupiter can't use ALTs and recommend `maxAccounts` or the [Flash-Fill pattern](https://github.com/jup-ag/sol-swap-flash-fill); (iv) the DBC min-fee first swap must be a top-level instruction (finding 2). Solana's v1 transaction format ([4,096 bytes](https://solana.com/upgrades/larger-transaction-sizes), expected on mainnet around 15 Sep 2026) **removes ALTs and keeps the 64-account cap**, and wallets must opt in. | **Launch with USDC or COIN:** one transaction of top-level instructions: `[CU budget] [peg_desk.buy_exact_out] [DBC init] [ATA create] [DBC swap]`. This is what the SDK's `createPoolWithFirstBuy` builds (a legacy transaction). **Launch with SOL:** use two transactions (Jupiter SOL→USDC plus Peg Desk, then DBC init plus first buy), or a Jito bundle for atomicity. Trying for one transaction means pinning Jupiter to `maxAccounts` ≈ 16–20 and a direct single-hop route. **Regular buys with SOL:** one transaction of top-level Jupiter + Peg Desk + DBC swap is feasible with an ALT. Drop CPI from `launch_router`; it becomes a client-side transaction builder. Pyth updates must already be posted by the keeper, because an inline verified Hermes update won't fit. |
| 9a | Holder payout cost, §3.5: "144k tx/day ≈ $700–1,500/day at 5–10k lamports" | **PARTIAL (arithmetic off; main cost missing)** | 144k tx × 5–10k lamports = **0.72–1.44 SOL/day**, about $110–360 at SOL $150–250. The $700–1,500 figure implies SOL at $500–1,000+. What's missing: **ATA rent of 0.00203928 SOL** per new recipient (165-byte account). 4k new recipients a day ≈ 8.2 SOL/day (~$1.2–2k/day), and it is **not recoverable**: the rent sits in the user's account. With inline ATA creation, the 64-lock limit allows about 10–12 recipients per transaction, not 20. §3.5's "~20 pools/tx" for DBC claims is also optimistic: about 5 unique accounts per pool gives about 10–12 pools per transaction. | Push only to wallets that **already hold a COIN ATA**. Everyone else goes to the Merkle claim, where the user pays for their own ATA. Alternatively, create ATAs only when cumulative accrual reaches $5 or more. Put a separate line in the budget for keeper SOL float and ATA rent. |
| 9b | DBC config rent | **ADD** | 0.00819 SOL, not closable (see 1c). | None. |
| 9c | ATA rent "~0.002 SOL" | **CONFIRMED** | (165 + 128) × 6,960 = 2,039,280 lamports. | Rewrite "recovered as protocol cost" as "absorbed as protocol cost". |
| 9d | Per-launch and per-migration costs (not in spec) | **ADD** | Pool creation (paid by the creator): virtual pool 424 B (0.00384) + 2 vaults (0.00408) + mint (0.00146) + Metaplex metadata (~0.0056) + Metaplex protocol fee (0.001–0.01 SOL, [Metaplex FAQ](https://www.metaplex.com/docs/smart-contracts/token-metadata/faq)) ≈ **0.02–0.025 SOL**, plus the creator's base ATA. Migration (paid by our keeper): the DAMM v2 pool, 2 positions, 2 Token-2022 NFT mints and accounts, and vaults, roughly 0.03–0.05 SOL per graduation [my estimate]. | Show the creation cost in the Launch wizard. Put the migration rent in the keeper budget, or recover it with `pool_creation_fee`. |
| 10 | 12-week plan and budget are complete (§7) | **PARTIAL** | See the next section. | See the recommended edits. |

---

## 10. Gaps in the plan and budget

**Token metadata.** DBC creates the Metaplex metadata itself inside `initialize_virtual_pool_with_spl_token` (`process_create_token_metadata.rs`). What's missing is off-chain:
- hosting the metadata JSON and image (Irys/Arweave, or pinned IPFS such as Pinata)
- **image moderation** for uploads (CSAM/NSFW; also needed for Jupiter/Dexscreener standing)
- the same work for the ~94 COIN mints, which need Metaplex metadata created by the Peg Desk mint-authority PDA

None of this is in the plan.

**COIN mints look "mintable".** COIN mints have a live mint authority (the Peg Desk PDA). RugCheck, Jupiter and terminals will flag every COIN, and possibly every pair, as mintable. Plan the Jupiter Verify application and docs around this. Keep the **freeze authority null**.

**Landing transactions.** There is no line item for:
- priority-fee estimation (Helius `getPriorityFeeEstimate`)
- Jito tips and bundles, for the two-transaction SOL launch and for keeper cycles that must be atomic
- retry and confirmation logic

The keeper also needs a **SOL float**: payouts, ATA rent, migrations and Pyth posts.

**Oracle posting cost.** For Tier A 24/7, posting 5–30 s updates for 6 feeds means about 17k–100k posts a day [estimate]. Each Hermes update needs Wormhole verification, which takes several transactions unless posted "atomic" with partial signatures. Batch feeds into one accumulator update. First check whether Pyth's sponsored push-feed accounts on Solana already cover these IDs; this is unverified.

**RPC and indexing budget ($3–5k for 12 weeks) is low.**
- Yellowstone gRPC or LaserStream-class streaming, plus an indexer that computes TWAB for every holder of 600+ mints, plus 15-minute payout cycles, realistically needs a paid Helius/Triton tier or a dedicated node.
- Budget $1.5–5k **per month** [U: vendor pricing not verified].
- The indexer must track DBC `EvtSwap` and DAMM v2 swaps to attribute fees, *and* all holders' token accounts per mint.
- Helius webhooks with address caps, or repeated `getProgramAccounts` scans with memcmp on the mint, will not scale to 1k pools every 15 minutes. Plan on a gRPC-fed holder table.

**Audit schedule.**
- Kicking off the audit in weeks 7–8 while features are still landing (Switchboard jobs, arb keeper, seeded pools) means there is no code freeze.
- Top-tier firms have 4–10 week lead times, so **book the slot in week 0**.
- A Peg Desk that prices off an oracle and mints/burns against a reserve counts as "complex DeFi". Accretion's public bands suggest the **$40–80k** estimate is at the low end for about 4k nSLOC across 5 programs.
- Budget for a fix review ($5–20k).

**Dependency on Meteora.** DBC is upgradeable by Meteora, and 0.2.1 (the version I read) is not in the published audit list.
- Recent releases changed the rules for existing integrators: the minimum fee went from 0.01% to 0.25%, rate-limiter mode was deprecated, and DAMM v1 migration was deprecated.
- Pin the IDLs, watch program upgrades, and add Surfpool mainnet-fork CI against the live program.

**Buyback via Jupiter CPI.** Same CPI account limits as above. Swap directly on the ICE/GLD pool (its DBC pool before graduation, DAMM v2 after) by CPI. That is two known programs, with no Jupiter dependency.

**`launch_router` scope.** Once the CPI design is dropped (finding 2), most of its 500 nSLOC and audit surface goes away. It becomes an SDK/transaction builder.

**Peg Desk `buy` for composed transactions.** When Peg Desk → DBC swap are separate top-level instructions, the DBC swap amount must be known in advance. Add `buy_exact_out(coin_out, max_usdc)` so the COIN amount is deterministic, or use DBC exact-out/partial-fill swaps.

---

## Recommended edits to ICEMARKETS_SPEC.md

1. **§3.2 curve:** replace the call with `buildCurveWithTwoSegments({ …base, initialMarketCap: 5_000/coinUsd, migrationMarketCap: 35_000/coinUsd, percentageSupplyOnMigration: 20 })`. State that `migrationQuoteThreshold ≈ 35_000 × 0.20 / coinUsd` COIN (about $7k), which is also the thin quote side of the DAMM v2 pool after graduation. Delete "same 800M/200M shape as the original"; the 20% is full-range liquidity, not an above-cap range.
2. **§3.2 configs:** switch `migrationFeeOption = 3` to `6 (Customizable)` with `migratedPoolFee = { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 100|200|300 }`. Add `enable_first_swap_with_min_fee: true` and `dynamicFeeEnabled: false`. Note that `config` is a keypair signer, `fee_claimer` can never be changed, and there is no way to close a config. Change to **one config per launch** (or rotate on more than 5–10% COIN/USD drift) so every market really starts at $5k in USD.
3. **§3.1 E / §3.3:** redesign `launch_router` as a **client-side transaction builder of top-level instructions**, not CPI. The USDC/COIN launch is one transaction. The SOL launch is two transactions or a Jito bundle. Regular SOL buys are one v0 transaction with an ALT and Jupiter `maxAccounts ≈ 20`. Replace "fits in 1.4M CU" with "the binding limits are 64 account locks and 1,232 bytes; CU ≈ 0.4–0.7M".
4. **§3.1 A:** add `buy_exact_out` to Peg Desk. Keep the COIN freeze authority null. Add Metaplex metadata for COIN mints.
5. **§3.1 B:** `fee_router` also handles `partner_withdraw_surplus`, `claim_partner_pool_creation_fee` and `withdraw_migration_fee`, and claims with `max_base_amount = 0`. Keep it upgradeable (Squads + 24 h timelock) because `fee_claimer` can't be changed. Consider a DAMM v2 `ClaimPositionFeeToOwner` delegate.
6. **§3.2 migration keeper:** replace "Meteora only auto-migrates SOL/USDC/JUP" with "Meteora's keepers migrate SOL/USDC/JUP pools and any pool whose quote is worth ≥ $750; we run our own keeper regardless (permissionless; `create_locker` first if vesting is used)". Budget about 0.03–0.05 SOL rent per graduation.
7. **§3.4 / D3 / §4 / Appendix B:** remove "WTI 24/7". The 24/7 set is GOLD, SILVER, PYTHOIL (blend), BRENT, NATGAS and CU. Use `WTI1M`/`BRENT1M`/`HHGAS1M` constant-maturity feeds (23/5) instead of rolling dated futures for energy. Keep the roll logic only for ags, livestock and dated metals.
8. **§3.5 costs:** fix the arithmetic to about 0.7–1.4 SOL/day in transaction fees at worst case. Add **ATA rent (0.00204 SOL per new recipient, not recoverable)** as the dominant cost. Change the policy: push only to wallets with an existing COIN ATA, and Merkle-claim for everyone else. Use about 10–12 recipients/pools per transaction, not 20.
9. **§3.3 / §5:** move the **seeded COIN/USDC pools into the MVP**, because Jupiter needs them to price and route COIN-quoted markets.
10. **§7 plan:**
    - Week 0: book the audit slot.
    - Weeks 3–4: metadata hosting (Irys/IPFS) and image moderation.
    - Priority-fee/Jito handling in the keeper and frontend.
    - Pyth posting strategy (batched accumulator updates, or sponsored feeds if available).
    - Code freeze before the audit starts.
    - Surfpool CI against live DBC/DAMM v2.
11. **§7 budget:**
    - RPC/indexing raised to about $1.5–5k/month.
    - New line for keeper SOL float (payout transactions, ATA rent, migrations, oracle posts).
    - Metadata/pinning at about $50–200/month.
    - Audit raised to $60–120k plus a fix review.
    - Per-launch on-chain cost (about 0.02–0.025 SOL, paid by the creator) shown in the UI.
12. **§4 feasibility table:**
    - Downgrade "No-cliff single pool like V6" to say trading **halts** between curve completion and migration (`PoolIsCompleted`).
    - Add a row for "Meteora dependency risk": DBC is upgradeable, and 0.2.1 is not in the published audit list.
