# ICEmarkets — Commodity Market Exchange on Solana

**Design spec, feasibility, scope test and execution plan**
Version 0.3 · 11 September 2026 · Prepared for Yashish

> A Solana fork of commodites.market (CME, Robinhood Chain): a launchpad where every memecoin is paired with a commodity coin (gold, crude, wheat, a Dragon Lore, a Charizard) instead of SOL, and 40% of every trading fee is paid to holders in that commodity coin, automatically. Built on Meteora Dynamic Bonding Curve → DAMM v2, Pyth + Switchboard oracles, and a small set of our own audited Anchor programs.

---

## 0. Decisions made (and why)

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | DEX / launchpad rail | **Meteora DBC → DAMM v2** | Permissionless for any classic-SPL quote mint (verified in `is_supported_quote_mint`), fully open source, 3 audits + Code4rena, Jupiter routes DBC/DAMM v2 pools automatically, terminals (Axiom, Photon, GMGN, BullX) already index DBC. Raydium LaunchLab needs Raydium's admin to bind every quote mint and its program is closed-source. Raydium stays Plan B. |
| D2 | Commodity coin peg | **"Peg Desk" — custom Anchor program: mint on buy / burn on sell at oracle ± dynamic spread, USDC reserve** | The original's two-position CLMM peg is a latency-arbitrage target on Solana (Jito bundles, bots already reading Hermes). Oracle-at-execution removes the stale-quote window, needs no repositioning keeper, and halts cleanly on stale feeds. |
| D3 | Oracle stack | **Pyth Core (primary, ~22 feeds incl. 24/7 gold/silver/PYTHOIL/brent/natgas/copper indices; constant-maturity WTI1M/BRENT1M/HHGAS1M for energy so no futures rolling) + Switchboard On-Demand (custom feeds: skins, cards, missing futures) + KeeperSigned bounded feeds (food, water, cars)** | Pyth is free, pull-based, has confidence intervals, and has 24/7 indices for the majors so weekend halts are avoided where it matters. Switchboard jobs can hit any HTTP API from a TEE. |
| D4 | Fee-to-holders | **Fee Router program PDA is DBC `fee_claimer`; keeper claims every 15 min; push payouts (nothing to claim) + Merkle claim fallback for dust** | Token-2022 transfer hooks are revoked at DBC graduation and rejected by DAMM v2 — dead end. Bags.fm runs exactly the PDA-claimer pattern in production. "Nothing to claim" is the original's best UX moment; keep it. |
| D5 | Fee split | Gross fee 1/2/3% (creator picks). Meteora takes a fixed 20% of it. Of our 80%: **50% holders / 25% $ICE buyback-burn / 25% protocol** = 40% / 20% / 20% of gross, 20% Meteora. No creator share (matches original after 8 Sep 2026). | Preserves the headline "40% to holders in the commodity coin". |
| D6 | Baskets (up to 5 coins) | **Index coins on the Peg Desk** (e.g. `PMX` = 40% GLD / 30% SLV / 15% XPT / 15% XPD, composite oracle; also `WATCHX`, `CS2X`) rather than 5 pools sharing one token — shipped at launch, no custom-basket builder | DBC mints one base token per pool; one token cannot sit in 5 DBC pools. An index coin gives the same product ("paired with a basket") with one pool, one payout token, one chart. |
| D7 | Categories | **11 categories**: metals, energy, agriculture, livestock, fast food, CS2 skins, game gold, trading cards, water, cars, **watches** (Rolex/AP/Patek/Omega/Cartier + G-Shock/Tissot as accessible entries; Switchboard `watch_*_median3` jobs, WatchCharts + Chrono24 + Collector Crypt). **Drugs excluded.** | Drugs have no real price data, and invite bans from Jupiter Verify, X, wallets, on-ramps; fentanyl is politically radioactive. Excluding them costs nothing technically. |
| D8 | Brand | **ICEmarkets** — ice-cream-cone mascot, Solana purple `#9945FF` → green `#14F195` gradient on near-black, monospaced numerals like the original. Tagline: *"Cool your commodities."* | Sounds like ICE without using Intercontinental Exchange's mark. Original characters, not a licensed one. |
| D9 | Platform token | **$ICE**, launched on our own launchpad **paired with GLD** ("the exchange coin is priced in gold"); 20% of gross fees buy and burn it | Dogfoods the product; a gold-denominated exchange token is a marketing hook the original doesn't have. |
| D10 | Compliance posture | Offshore entity; frontend geo-block US/UK/sanctioned; no leverage; "synthetic, no claim on any commodity, redeemable only against protocol reserve, may halt" disclosure; counsel review before mainnet; generic names for trademarked items (`BURGER` not `BIGMAC`) | CFTC treated Opyn/ZeroEx/Deridex synthetics as swaps and called IP blocking "not sufficient" — this is real risk, not paperwork. |

---

## 1. What we are forking — the original, precisely

Observed live on 11 Sep 2026 (screenshots in `/research/screenshots`):

**Product.** 647 markets, 94 commodity coins, $9.6M 24h volume, $14.2M TVL, $79.2K paid to holders (4K wallets), 4.78M $CME burned (0.48%). Nav: Markets · Commodities · Launch · Rewards · Docs.

**Market lifecycle (V6).** 1,000,000,000 fixed supply. All of it goes into a Uniswap v4 pool at creation: 800M in a concentrated "curve range" from $5,000 to $35,000 market cap (denominated in the pair coin, fixed at creation), 200M in a "reserve range" above the cap so it "keeps quoting with no cliff". Creator picks 1/2/3% fee, must make a ≥$1 first buy. Routable by any terminal from block one.

**How 94 "assets" get on-chain (the key insight).** They don't. No gold, burgers or skins are held anywhere. Each commodity coin is a plain protocol-minted token whose *price* is enforced by an oracle feed and a pool the protocol controls. Adding a commodity = a price source + a mint + a pool. Redeemability is only against the USDG buyers have paid in, which is why the protocol is structurally short everything it issues.

**Commodity coin peg.** Each coin (GLD = 1 oz gold) has a single-sided Uniswap v3 pool: protocol-minted ask one tick above feed price, USDG bid one tick below. Keeper (60s) reprices when price crosses a tick or a side runs dry. Feeds: front-month futures (metals/energy/ags/livestock), published menu prices (food), lowest live listing (skins), median of cheapest offers (RSGP), TCGplayer (cards). Staleness: 6h live sources, 72h futures. When stale, the market page shows *"A current price is unavailable. Market value will return when the price feed recovers."* (seen live on $COPPERINU).

**Fees.** 40% holders (in the pair coin, balance-weighted, every 15 min, ≥$100 pool unpaid, ≥$5 holding, ≥$1 payout) · 30% $CME buyback-burn · 30% protocol. No creator share.

**Baskets.** Up to 5 coins, weights sum to 100%, min 5% each; each leg gets its own pool; router splits orders by fitted slippage curves.

**"Tokenize anything".** Search TCGplayer's catalogue (497K products, 44.1K "deep enough"); pay 0.02 ETH to mint a new commodity coin for any sufficiently liquid card/box and pair with it immediately.

**UI.** Dark (#0B0E11-ish), Inter + monospace numerals, green accent. Market card: image, $TICKER, name, pair chip, FDV, curve progress bar, 24h vol, "Migrated" tag. Market page: header (pair chip, contract, explorer), 3 stat tiles (Pool / Trading fee / Holder earnings), GMGN-embedded TradingView chart with "GMGN | Official" toggle, Trades table, Buy/Sell panel with "Pay with ETH | USDG | <COIN>", Official pools list, creator line. Rewards page: 3-step explainer, leaderboard by holder share with per-coin filter chips.

---

## 2. Landscape (Sept 2026) — why now, and what we're up against

- **StonkFun** (Solana, stocks): moved to Raydium LaunchLab 5–6 Sep; $STONK +250% to $140M mcap, $135M daily volume; Solana's X account posted "We stand behind Stonk Tokens". Proves Solana wants asset-paired launchpads *right now*.
- **Ember (embercurve.fun)** (Solana, stocks, Meteora DBC): 150+ tokenized stocks as quote; creator routes 80% of fees to holders/burn/lotto/team. No platform token found.
- **Lattice** (Solana, Meteora DBC): 740 xStocks / 443 Ondo / 19 Backpack tokens as quote.
- **pump.fun Custom Pairs** (9 Sep): 93 allow-listed quote assets incl. "metals". A competitor, not a platform.
- **Nobody has done commodities on Solana.** The original is on Robinhood Chain; StonkFun lists "commodities" only via ETF-style tokens. The whitespace is real and closing fast.

**Reference gold tokens on Solana** (can back our GLD reserve): PAXG (native Token-2022, June 2026), XAUt0 (LayerZero OFT), Matrixdock XAUm, Oro GOLD. Tokenized gold mcap on Solana +689% YoY.

---

## 3. System architecture

```
                        ┌──────────────────────────────────────────────────────────┐
                        │                     ICEmarkets frontend (Next.js)               │
                        │  Markets · Commodities · Launch · Rewards · Docs         │
                        └────────────┬───────────────────────────┬────────────────┘
                                     │ tx build                   │ read
                                     ▼                            ▼
   ┌─────────────────────────────────────────────┐   ┌──────────────────────────────┐
   │              ON-CHAIN (Solana mainnet)      │   │   OFF-CHAIN (our infra)       │
   │                                             │   │                              │
   │  [Meteora DBC]  ─graduates→  [Meteora DAMM v2]  │  Indexer (Helius webhooks /   │
   │     ▲ quote = COIN            ▲ LP NFTs held by │   Yellowstone gRPC → Postgres)│
   │     │                         │ Fee Router PDA  │  Keeper cluster:              │
   │  [Peg Desk]  USDC ⇄ COIN @ oracle ± spread      │   • oracle pusher (1–60s)     │
   │     ▲ reads Pyth PriceUpdateV2 / Switchboard /  │   • fee claimer + splitter    │
   │     │ KeeperPrice                               │     (15 min)                  │
   │  [Fee Router] claim → 50% HolderVault           │   • holder payout (15 min)    │
   │                    → 25% BuybackVault           │   • buyback+burn (15 min)     │
   │                    → 25% Treasury               │   • DBC migration (on full)   │
   │  [Distributor] push payouts + Merkle claims     │   • peg-pool arb (COIN/USDC)  │
   │  [Buyback] COIN→USDC→ICEmarkets (Jupiter CPI) → burn  │   • roll/blend futures        │
   │  [ICEmarkets mint]  classic SPL                       │  API (tRPC/REST): markets,     │
   │  [COIN mints] classic SPL, authority = Peg Desk │   quotes, payouts, leaderboard│
   └─────────────────────────────────────────────┘   └──────────────────────────────┘
```

### 3.1 Programs we write (Anchor, Rust)

**A. `peg_desk`** — commodity coin issuer. Size ~1.5–2k nSLOC.

Accounts
- `GlobalConfig` PDA["config"]: admin (Squads multisig), keeper set, treasury, reserve_mint (USDC), global_pause, max_conf_bps.
- `Commodity` PDA["cmdty", symbol]: coin_mint (mint authority = PDA), oracle_kind {PythPull, PythPush, Switchboard, KeeperSigned, Composite}, feed ids/accounts, unit_scale (¢→$, EUR→USD needs FX feed), session_calendar, max_age_open / max_age_closed, base_spread_bps, closed_spread_bps, conf_mult, supply_cap, per_tx_cap, per_slot_net_cap, last_publish_time, roll_state, status {Open, Closed, Halted}.
- `ReserveVault` (USDC ATA per commodity), optional `HedgeVault` (PAXG/XAUt0 for GLD, SLV token for SLV).
- `KeeperPrice` PDA["kp", symbol]: price, conf, ts, source_hash; bounded move (±5%/update), min interval, multisig authority.
- `IndexDef` (for D6 baskets): up to 5 (commodity, weight_bps) legs.

Instructions: `buy(usdc_in, min_out)`, `sell(coin_in, min_out)`, `keeper_update_price`, `roll_contract(next_feed, blend_days)`, `set_params`, `pause`, `sweep_spread_fees`, `rebalance_hedge`.

Pricing rule: `ask = p·(1 + base + conf_mult·conf/p + age_penalty + session_add)`, `bid` mirrored. Require `now − publish_ts ≤ max_age(session)`, `publish_ts ≥ last_publish_time` (no cherry-picking), `conf/p ≤ max_conf`. Reserve-ratio circuit breaker: <102% → widen spread and cap buys; <98% → halt buys, alert.

**B. `fee_router`** — ~600 nSLOC. PDA["router"] is `fee_claimer` on every DBC config and owner of DAMM v2 position NFTs. `claim_dbc(pool)` and `claim_damm(position)` via CPI, then `split(pool)` → 50/25/25 into `HolderVault[pool]`, `BuybackVault`, `Treasury`. Permissionless crank (anyone can call; keeper does).

**C. `distributor`** — ~700 nSLOC. `push_payout(pool, [(wallet, amount)])` signed by keeper set, bounded by `HolderVault[pool]` balance and per-epoch cap; `post_merkle_root(pool, epoch, root, total)`; `claim(pool, epoch, proof)`. Every payout emits an event the frontend reads for the Rewards page.

**D. `buyback`** — ~400 nSLOC. `convert(coin) → USDC` via Peg Desk `sell` CPI (no external DEX needed — our own desk is the exit), `buy_icemarkets` via Jupiter CPI or DAMM v2 swap on ICE/GLD, `burn`. Bounded per cycle; 2% reserve buffer kept for holder obligations like the original.

**E. `launch-builder` (client-side TypeScript, not a program).** Verification found that DBC only grants the creator's cheap first buy (`enable_first_swap_with_min_fee`) when the swap is a *top-level* instruction following `initialize` in the same tx — a CPI wrapper would cost creators the 25% anti-sniper fee. So launch is composed of top-level instructions: Peg Desk `buy_exact_out(COIN)` → DBC `initialize_virtual_pool_with_spl_token` → DBC `swap` (first buy). **Launch with USDC/COIN = 1 tx; launch with SOL = 2 tx (Jupiter SOL→USDC first) or a Jito bundle.** Regular buys: Jupiter SOL→USDC (capped ~20 accounts) + Peg Desk + DBC swap in one tx with an address lookup table. Binding limits are 64 accounts / 1,232 bytes (v1 tx format → 4,096 bytes expected mid-Sep 2026), not compute (~0.4–0.7M CU). Removing the CPI router also shrinks the audit surface.

Peg Desk additions from verification: `buy_exact_out`; COIN **freeze authority = null**; Metaplex metadata for every COIN; expect RugCheck/Jupiter to flag COIN as "mintable" (mint authority is the PDA by design) — document it on the coin page.

### 3.2 Meteora configuration

- **One DBC config per launch** (config is a fresh keypair that must sign; rent 0.0082 SOL, never reclaimable; no whitelisting needed). Per-launch configs matter because market caps are converted to COIN units at config time — a shared config's "$5k→$35k" would drift as COIN/USD moves. (Alternative: shared configs per coin × tier, rotated on >5–10% drift.)
- Config: `quote_mint = COIN`, `collectFeeMode = 0 (quote)`, flat base fee 100/200/300 bps (dynamic fee off, `enable_first_swap_with_min_fee = true`), `creatorTradingFeePercentage = 0`, `fee_claimer = fee_router PDA` (**immutable after creation** → fee_router stays upgradeable behind Squads multisig + timelock), `migrationOption = DAMM v2`, **`migrationFeeOption = 6 (Customizable)`** with `poolFeeBps` = tier and fees in quote — the fixed options (0–5) would pin every graduated pool to Meteora's preset (e.g. 2%) and Meteora's own collect mode. LP 100% partner, permanently locked. `tokenSupply = 1B`.
- Curve: **`buildCurveWithTwoSegments({ initialMarketCap: 5_000/coinUsd, migrationMarketCap: 35_000/coinUsd, percentageSupplyOnMigration: 20, totalTokenSupply: 1e9, … })`**. (`buildCurveWithMarketCap` has no supply-split parameter — it derives ~27.4% migrated for a 7× cap ratio.) Quote threshold ≈ $7k of COIN (= migrationMcap × 20% ÷ (1 − migration fee)), which is also the graduated pool's depth. Shape is 800M/200M like the original, but graduation is an event: trading pauses for the seconds between curve completion and migration.
- Migration keeper: Meteora auto-migrates SOL/USDC/JUP quotes and a second keeper handles pools whose quote is worth ≥ $750 — we still run our own to guarantee sub-minute graduation (`migrate_damm_v2` is permissionless; ~0.03–0.05 SOL per graduation, budgeted).
- After graduation the Fee Router PDA holds the locked position NFT and claims 80% of DAMM v2 LP fees (Meteora keeps 20%). Fee Router also claims DBC surplus, pool-creation and migration fees, passing `max_base_amount = 0`. Consider a keeper delegate for DAMM v2 claims. Note anyone can add liquidity to the graduated pool and dilute our LP share of fees.

### 3.3 Trading routes (what the user sees vs what happens)

| User action | Under the hood |
|---|---|
| Buy $COPPERINU with SOL | Jupiter SOL→USDC · Peg Desk USDC→HG · DBC swap HG→COPPERINU (1 tx, ~3 CPIs, fits in 1.4M CU with ALT) |
| Buy with USDC | Peg Desk USDC→HG · DBC swap |
| Buy with HG (already hold it from payouts) | DBC swap |
| Sell to USDC | DBC swap → HG · Peg Desk HG→USDC |
| Trade on Axiom/Photon/Jupiter | They see a normal HG-quoted DBC/DAMM v2 pool. Jupiter routes SOL→HG (and runs its $500 round-trip listing test) only if a routable HG pool exists → we seed a **thin DAMM v2 COIN/USDC pool per launch coin (v1.0)** kept at peg by our keeper-arb bot (profit stays in-house). Backlog, not v1.0: Jupiter AMM integration for the Peg Desk itself. |

### 3.4 Oracle & staleness matrix

| Tier | Coins | Source | Cadence | Max age (open / closed) | Spread |
|---|---|---|---|---|---|
| A 24/7 | GLD, SLV, OIL (PYTHOIL blend), BZ, NG, HG | Pyth 24/7 indices | 5–30 s on 0.1% deviation | 60 s / n.a. | 10 bp |
| A hours | CL (WTI1M), XPT, XPD, ALI, ZW, ZC, ZS, SB, KC, CC, LE | Pyth constant-maturity (WTI1M/BRENT1M/HHGAS1M), spot/LME, dated futures + keeper roll blend for ags | 30 s | 120 s / sell-only at 150 bp, or Halted | 15 bp |
| B intraday | RB, HO, ZM, ZL, ZR, ZO, CT, OJ, GF, HE, DC, LBR, USO | Switchboard job over licensed vendor (Databento / Barchart / Polygon.io) | 60 s | 5 min / 72 h halt | 25 bp |
| B market | 12 CS2 skins, RSGP | Switchboard job: median of Pricempire + CSFloat + Skinport (+ Steam) | 5 min | 1 h | 100 bp |
| C slow | 25 trading cards | Switchboard job: median(TCGplayer via pokemontcg.io / tcgapi + PriceCharting, **Collector Crypt** vaulted-card sales) | 1 h | 48 h | 150 bp |
| C slow | 10 watches | Switchboard job: median(WatchCharts, Chrono24*, **Collector Crypt** vaulted-watch sales) — *Chrono24 has no public API; source stays disabled (falls back to the other two) until a compliant path exists | 1 h | 48 h | 150 bp |
| C manual | 13 fast food, H2O, LAMBO | KeeperSigned (multisig, ±5%/update) | weekly / on change | 30 d | 200 bp |

Weekend behaviour: Tier A-24/7 trades through; Tier A-hours defaults to **sell-only at wide spread** (so holders can always exit) and resumes at open; the market page shows the same *"price feed recovering"* banner as the original.

### 3.5 Holder payout algorithm (keeper, every 15 min)

1. `fee_router.claim_dbc / claim_damm` for every pool with ≥ $100-equivalent unclaimed (batched, ~20 pools/tx).
2. For each pool: eligible holders = indexer time-weighted average balance over the epoch, excluding pool vaults, LP, burn address, program PDAs; holding ≥ $5.
3. `share_i = holder_vault · twab_i / Σ twab`. Payouts ≥ $1 are **pushed only to wallets that already hold a COIN token account** (`distributor.push_payout`); wallets without one, and sub-threshold amounts, accumulate into a Merkle epoch the holder claims any time (they pay their own ~0.00204 SOL ATA rent on first claim). Push-creating ATAs would make rent (0.00204 SOL × new holders) the dominant, unrecoverable cost.
4. Emit `Payout{pool, wallet, coin, amount, epoch}` → Rewards page, leaderboard, per-wallet "earned" view.

Cost estimate (corrected): worst case 600 pools × 50 holders × 96 cycles ≈ 2.9M transfers/day; at a realistic 10–12 transfers/tx ≈ 260k tx/day × 5–10k lamports ≈ 1.3–2.6 SOL/day (~$200–500). Thresholds cut this >10× in practice (the original pays ~4K wallets/day). ATA rent, if we did create them, would be ~8 SOL/day at 4K new holders — hence the push-only-to-existing-ATA rule.

### 3.6 Frontend (Next.js 15, App Router, Tailwind, wallet-adapter, TanStack Query)

Pages: `/` Markets (hero stats, "Where the fees go" bar, New launches, Live markets grid with All / New / Migrated tabs + sort), `/commodities` (category grid with live price, %, market count; "Tokenize anything" search), `/commodities/[sym]` (chart, contract, Buy/Sell for USDC), `/launch` (3-step wizard: Paired with → Identity → Fee & first buy; right-rail Overview), `/token/[mint]` (header, 3 stat tiles, chart with GMGN | Official toggle via Birdeye/own OHLC, trades, Buy/Sell "Pay with SOL | USDC | COIN", official pools, creator), `/rewards` (3-step explainer, connected-wallet earnings, leaderboard with coin chips), `/docs`. Charts: TradingView Lightweight Charts fed by our indexer; GMGN embed once listed. Geo-block middleware (Vercel edge) + ToS acceptance modal. Mascot appears in empty states, loading, and the 404.

Brand tokens: bg `#0A0A0F`, surface `#12121A`, text `#F5F5F7`, accent gradient `linear-gradient(90deg,#9945FF,#14F195)`, positive `#14F195`, negative `#FF5C5C`, mono `JetBrains Mono` for numerals, sans `Inter`.

---

## 4. Feasibility

| Area | Verdict | Evidence / caveat |
|---|---|---|
| Custom quote token on DBC | ✅ Confirmed | `is_supported_quote_mint` accepts any classic SPL mint; Lattice and Ember do it today. |
| Fees in commodity coin | ✅ Confirmed | `collectFeeMode = 0`. PDA as `fee_claimer` has no cooldown; Bags does it. |
| 40/20/20 split after Meteora's 20% | ✅ | Arithmetic; Meteora's cut is fixed and non-negotiable. |
| No-cliff single pool like V6 | ⚠️ Approximated | DBC has a graduation event: trading halts (`PoolIsCompleted`) for the seconds until `migrate_damm_v2` lands; DAMM v2 opens at the same price. A DLMM-native V6 clone is possible later but loses screener/terminal indexing. |
| Baskets | ⚠️ Redesigned | Index coins (D6). Not per-leg pools. |
| Auto-payouts to holders | ✅ | Push + Merkle. Cost bounded by thresholds. |
| 24/7 trading for majors | ✅ | Pyth 24/7 indices (launched Mar–Jun 2026) for gold, silver, PYTHOIL (blend), Brent, natgas, copper. WTI itself is 23/5 (WTI1M). |
| Meteora dependency | ⚠️ | DBC is upgradeable by Meteora; v0.2.1 not yet in the published audit list; recent releases changed min fee and deprecated modes. Pin interfaces, run CI against the live mainnet program via Surfpool. |
| Weekend trading for other futures | ⚠️ | Sell-only/halt. Same limitation as the original (72 h staleness). |
| Terminal support (Axiom/Photon) | ⚠️ | They index DBC pools, but display of non-SOL quotes varies; routing needs a COIN/USDC pool. Mitigated by seeded pools + keeper arb. |
| Jupiter routing of Peg Desk | ⏳ Backlog (not v1.0) | Requires `jupiter-amm-interface` impl, audit, traction. Prop-AMM pattern is well trodden. |
| "Tokenize anything" (TCGplayer) | ✅ Backlog (not v1.0) | pokemontcg.io / tcgapi / PriceCharting; depth screen = 30-day sales count. |
| Regulatory | ⚠️ Material risk | Synthetic commodity exposure to retail ≈ swap under CEA. Offshore + geo-block + disclosures + counsel. Not a blocker for a memecoin launchpad by industry practice (StonkFun, Ember, Lattice), but it is the top risk. |
| Reserve solvency (short delta) | ⚠️ | Protocol is short every coin it mints. Hedge GLD/SLV with PAXG/SLV-token vaults; cap supply on the rest; spread income accrues to reserve. Model in §6. |

**Overall: feasible for production in ~10–12 weeks with a 4-person team**, with the Peg Desk + Fee Router + Distributor as the audit surface (~3.5k nSLOC).

---

## 5. Scope test — v1.0 (single release, no phases)

Everything below ships together — there is no MVP/v1.1/v2 split. A capability either is in v1.0 or it is future work called out explicitly in `docs/BUILD_STATUS.md`'s Backlog (Jupiter AMM integration for the Peg Desk itself, tokenize-anything, an agent-kit chat bot, hedge-vault rebalancing).

| Capability | v1.0 (single release) |
|---|---|
| Commodity coins | **93 commodities** (metals, energy, agriculture, livestock, fast food, CS2 skins, RSGP, 25 trading cards, water, cars, **10 watches**) + **3 index coins** (PMX, WATCHX, CS2X) |
| Launch | Single coin or a ready-made index coin, 1/2/3% fee, first buy, 1 tx |
| Trading | SOL/USDC/COIN in & out, own UI, Jupiter routing via seeded COIN/USDC pools |
| Rewards | 15-min push payouts + Merkle, leaderboard, per-wallet history export |
| $ICE | Launch paired with GLD, buyback-burn, burn dashboard |
| Charts | Own OHLC (Lightweight Charts); GMGN/Birdeye embed |
| Compliance | Geo-block, ToS, disclosures, legal opinion before mainnet |

Not in v1.0 (no date attached, tracked as backlog, not a phase): custom baskets (build-your-own beyond the 3 ready-made index coins), creator vesting / Alpha Vault, Peg Desk as a Jupiter AMM, referral share, tokenize-anything (open TCGplayer catalogue), entity/licensing review.

---

## 6. Economics & risk model (numbers to validate in week 2 with a simulation notebook)

- **Revenue.** Original does ~$9.6M/day volume at ~2% avg fee ≈ $190k/day gross; 20% protocol = $38k/day. At 10% of that on Solana day-30 (~$1M/day) → protocol $4k/day, buyback $4k/day, holders $8k/day.
- **Peg Desk P&L.** Spread income (10–200 bp) + arb losses (stale quotes) + delta P&L (short commodity). Sim: 1-year backtest of gold/oil with 60 s update lag and 10 bp spread; target: spread ≥ 3× expected arb loss. Hedge GLD 100% with PAXG in `HedgeVault` via keeper rebalances; SLV same; oil/gas via CEX perps from treasury (manual, not on-chain) or unhedged with supply cap ≤ $250k per coin at launch.
- **Reserve ratio alerts** at 105/102/98%.
- **Top risks** (ranked): 1) CFTC/swap characterization; 2) reserve insolvency on a commodity rally; 3) oracle latency/roll/weekend arb; 4) terminal/Jupiter display of COIN-quoted pairs; 5) StonkFun/pump.fun adding commodities first; 6) trademark C&Ds (use generic names); 7) keeper key compromise (Squads multisig, bounded moves, hot-key rotation).

---

## 7. Execution plan (12 weeks, 4 people: Rust/Anchor lead, backend/keeper, frontend, design+GTM 0.5)

**Week 0 (this week) — Foundations.** Entity + counsel intro; **book the audit slot now** (top firms have 4–10 week lead times; code freeze end of week 7); Helius/Triton RPC + Yellowstone gRPC (holder-balance tracking needs a streamed index, not webhooks); Squads multisig; GitHub monorepo (`programs/`, `keeper/`, `indexer/`, `web/`, `sdk/`, `sim/`); Surfpool mainnet-fork CI against live Meteora programs; devnet Meteora DBC config with a test GLD mint; Irys/IPFS pinning + image moderation for launch metadata; brand kit v0 (ICEmarkets cone mascot, palette, wordmark); X account (@launchonICEmarkets or similar), Premium subscription; register domain.

**Weeks 1–2 — Peg Desk core + oracle plumbing.** `peg_desk` buy/sell with Pyth pull (Hermes → receiver), staleness/conf/monotonic gates, caps, pause; keeper oracle pusher for 6 Tier-A coins; simulation notebook (§6); frontend skeleton with Markets/Commodities from mock data. *Exit: buy/sell GLD on devnet at Pyth price.*

**Weeks 3–4 — Launch path end to end.** `launch-builder` (top-level ix: Peg Desk buy_exact_out → DBC init → first swap; SOL path as 2 tx/bundle); per-launch DBC config with two-segment curve + option-6 migration; priority-fee / Jito landing layer + keeper SOL float; migration keeper; indexer (Helius webhooks → Postgres: pools, trades, holders, OHLC); `/launch` and `/token/[mint]` pages live on devnet. *Exit: launch a memecoin paired with GLD on devnet from the UI, trade it, graduate it to DAMM v2.*

**Weeks 5–6 — Fees to holders.** `fee_router` (DBC + DAMM v2 claims via CPI, 50/25/25 split); `distributor` push + Merkle; TWAB computation in indexer; `/rewards` page; `buyback` program with Peg Desk exit + ICEmarkets swap + burn. *Exit: 15-min cycles paying devnet holders in GLD.*

**Weeks 7–8 — Breadth + hardening.** Switchboard jobs for skins/RSGP/cards; KeeperSigned feeds for food/water/cars; futures roll blending; session calendar; seeded COIN/USDC DAMM v2 pools + keeper arb; geo-block + ToS; load test keeper at 1k pools; chaos tests (oracle outage, RPC failover, keeper crash mid-cycle). **Audit kickoff** (Peg Desk, Fee Router, Distributor, Buyback, Launch Router — Accretion/OtterSec/Sec3, budget $40–80k, 3–4 weeks).

**Weeks 9–10 — Audit fixes, mainnet dress rehearsal.** Deploy to mainnet behind allowlist; real Pyth feeds; seed reserves ($100–250k USDC + PAXG hedge for GLD); private beta with 20 launches; trailer (Veo 3.1/Kling clips + editor, $500–2k); docs site; Dexscreener Enhanced Token Info, Jupiter Verify application for $ICE and the 6 Tier-A coins; Birdeye token info.

**Week 11 — $ICE launch + public open.** Launch $ICE paired with GLD on our own curve (fair launch, anti-sniper decay), open launchpad to public, KOL wave, Meteora + Solana ecosystem outreach for amplification (StonkFun got a Solana account quote-tweet), Telegram + X-native community.

**Week 12 — Stabilize + backlog kickoff.** Any coin/edge-case cleanup from the private beta; start the backlog items that stay explicitly out of v1.0 (Jupiter Peg Desk integration PR, tokenize-anything).

**Budget (12 weeks).** Team $120–200k (or founder-built) · audit $60–120k incl. one fix review · RPC/gRPC/indexing $1.5–5k/mo ≈ $5–15k · Pyth posting + keeper SOL float ≈ 20–60 SOL · pinning $50–200/mo · data APIs $1–2k · reserves/hedge $100–250k (recoverable capital, not spend) · legal $15–40k · brand/trailer/KOL $10–40k · X Premium/Verified Org ~$100–1,000. **Total spend ≈ $215–430k + $100–250k reserve capital.** Per-launch on-chain cost shown in UI: ≈ 0.02–0.025 SOL (config rent + Metaplex + pool) plus first buy; each graduation costs us ≈ 0.03–0.05 SOL.

---

## 8. Testing & verification plan

- Unit: Anchor tests (Rust + TS) for every instruction; property tests on pricing math (spread monotonic, no negative reserve).
- Integration: Surfpool/bankrun mainnet-fork with real Meteora DBC/DAMM v2 programs and Pyth receiver; full launch→trade→graduate→claim→payout flow.
- Economic: notebook backtests (§6) and adversarial bot that front-runs oracle updates on devnet to measure arb leakage vs spread.
- Ops: keeper chaos tests; alerting (Grafana + PagerDuty) on reserve ratio, feed age, failed cycles; runbooks for pause/halt.
- Security: audit (§7), bug bounty (Immunefi-style, $50k pool) at launch, Squads multisig with 24h timelock on `set_params` for majors.
- Acceptance for "production ready": 7 consecutive days on mainnet-beta private with 0 failed payout cycles, peg deviation < spread 99.9% of samples, and audit findings closed.

---

## 9. Open items for Yashish

1. **X location** — x.com is blocked for automated tools; open @solana / @RaydiumProtocol / @MeteoraAG manually and copy the location string. (Mostly cosmetic; the real lever is getting a Solana/Meteora quote-tweet.)
2. Entity jurisdiction and counsel (BVI/Cayman/Panama are typical); I can draft the brief.
3. Reserve capital size at launch ($100k vs $250k) — sets per-coin supply caps.
4. Do you want to hedge oil/gas via CEX perps (operational) or leave unhedged with tight caps?
5. Team: are you building solo with me, or hiring? The plan assumes 4 people; solo-with-Claude roughly doubles calendar time to ~20–24 weeks.

---

## Appendix A — Commodity coin list (93, drugs excluded) + 3 index coins

Metals (6): GLD Gold /oz · SLV Silver /oz · XPT Platinum /oz · XPD Palladium /oz · HG Copper /lb · ALI Aluminium /t
Energy (7): CL WTI /bbl · BZ Brent /bbl · OIL Oil (Pyth 24/7 blend) /bbl · USO Oil fund /unit · NG Natural Gas /MMBtu · RB Gasoline /gal · HO Heating Oil /gal
Agriculture (14): LBR Lumber /mbf · ZW Wheat /bu · ZC Corn /bu · ZS Soybeans /bu · ZM Soybean Meal /ton · ZL Soybean Oil /lb · ZR Rice /cwt · ZO Oats /bu · SB Sugar /lb · KC Coffee /lb · CC Cocoa /t · CT Cotton /lb · OJ Orange Juice /lb · DC Milk /cwt
Livestock (3): LE Live Cattle /lb · GF Feeder Cattle /lb · HE Lean Hogs /lb
Fast food (13, generic tickers): BURGER, NUGGETS, WHOPPR→BIGBURGER, CHIXSAND, TACO, BURRITO, LATTE, PIZZA, DBLBURGER, BACONBURGER, SPICYCHIX, MEDCOFFEE, FRIES — /item
CS2 skins (12): AKREDLINE, AWPASIIMOV, DLORE, HOWL, KARAMBIT, BFLYFADE, DEAGLBLAZE, GLOCKFADE, PRNTSTREAM, VICEGLOVES, BRAVOCASE, VULCAN — /item
Game gold (1): RSGP OSRS Gold /M gp
Trading cards (25): 13 ETBs (151, Prismatic Evolutions, Destined Rivals, Ascended Heroes, Chaos Rising, Phantasmal Flames, Twilight Masquerade, Surging Sparks, Black Bolt, White Flare, Mega Evolution, Crown Zenith, Obsidian Flames) + 12 singles (Umbreon ex SIR 161/131, Umbreon VMAX Alt Art, Charizard ex SIR 199/165, Charizard ex SIR 223/197, Base Set Charizard, Pikachu ex SIR 238/191, Mew ex SIR 232/091, Team Rocket's Mewtwo ex SIR, Mega Charizard Y ex 294/217, Giratina V Alt Art, Cynthia's Garchomp ex SIR, N's Zoroark ex SIR) — /box, /card
Water (1): H2O California Water /af
Cars (1): LAMBO Lamborghini Temerario /car
Watches (10): SUBMARINER Rolex Submariner Date 126610LN · DAYTONA Rolex Cosmograph Daytona 126500LN · GMTMASTER Rolex GMT-Master II 126710BLNR · DATEJUST Rolex Datejust 41 126334 · ROYALOAK AP Royal Oak 15510ST · NAUTILUS Patek Philippe Nautilus 5811/1G · SPEEDMSTR Omega Speedmaster Moonwatch · SANTOS Cartier Santos Large WSSA0018 · GSHOCK Casio G-Shock DW-5600E · TISSOTPRX Tissot PRX Powermatic 80 — /watch (unworn, full set); priced from WatchCharts + Chrono24 (disabled, no public API) + Collector Crypt vaulted-watch sales

Index coins (3, Composite oracle, D6): PMX Precious Metals Index (40% GLD / 30% SLV / 15% XPT / 15% XPD) · WATCHX Luxury Watch Index (25% SUBMARINER / 25% DAYTONA / 20% ROYALOAK / 20% NAUTILUS / 10% SPEEDMSTR) · CS2X CS2 Skins Index (25% KARAMBIT / 25% HOWL / 25% DLORE / 15% AWPASIIMOV / 10% AKREDLINE)

## Appendix B — Pyth feed IDs used at launch (Tier A)

GOLD 24/7 `fa0f5750…6b01` · SILVER 24/7 `6afca47e…52d3` · PYTHOIL 24/7 `67784f72…ef14` · WTI1M (23/5) for CL · BRENT 24/7 `f33ce961…fda6` · NATGAS 24/7 `45f95717…f71c` · CU 24/7 `b2b238ae…8c59` · XPT `398e4bbc…a34e5` · XPD `80367e96…9021` · AL3M `9397ba38…0cb6` · WHZ6 `3f4760e9…b80f` (¢) · COZ6 `417f8c1e…56b1` · SOX6 `20b5c568…2516` (¢) · RSV6 `083ec542…8059` (¢) · CFZ6 `a61c21c0…3e8f` (¢) · CAZ6 `7452a0c6…3ea` · LCV6 `38f7825b…2d83` (¢). Full IDs in `research/oracles.md`.

## Appendix C — Sources

Research reports (agents, 11 Sep 2026) saved alongside this spec: `research/01-reference-products.md`, `research/02-solana-launchpad-infra.md`, `research/03-oracles-and-peg.md`, `research/04-brand-gtm.md`, and an independent code-level verification pass `research/05-verification.md` (read Meteora DBC @ f552f20, SDK 1.5.12, DAMM v2 0.2.4) whose corrections are folded into this version. Key primary sources: docs.meteora.ag (DBC configs, fees, CPI, DAMM v2), github.com/MeteoraAg/dynamic-bonding-curve, docs.raydium.io (LaunchLab global/platform config, changelog), developers.jup.ag (market listing, AMM integration), hermes.pyth.network (feed list), docs.switchboard.xyz, commodites.market (/, /docs, /commodities, /launch, /rewards, /token/*), theblock.co (StonkFun 6 Sep 2026), cftc.gov (8774-23), solana.com/branding.
