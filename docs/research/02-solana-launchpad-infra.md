# Solana launchpad due diligence: memecoins quoted in a custom commodity coin (GOLD), with 40% of fees paid to holders in GOLD

**As of 11 Sep 2026.** I checked Meteora and Raydium claims against their source code (Meteora DBC commit `f552f20`, 9 Sep 2026; DAMM v2 repo, 8 Sep 2026; Raydium's CPI repo, IDLs and docs), their docs and recent news. Labels: **[C]** means confirmed from code or official docs. **[U]** means uncertain or secondary-source only.

---

## TL;DR

- **Meteora DBC takes any classic SPL mint as a quote token, with no permission needed [C].** If GOLD is a classic SPL mint, or a Token-2022 mint with only metadata extensions, you create your own config and launch.
- **Meteora gives you the most room to route fees to holders.** Trading fees can be collected in the quote coin. Your own program's address (a PDA) can be the partner fee claimer, and Bags.fm already runs this pattern in production.
- **Raydium LaunchLab supports custom quote tokens, but only if Raydium's admin creates a config for your mint [C].** Its program source is not public [C]. StonkFun is running exactly your concept on it right now (98 quote mints in 12 hours) [U, press].
- **pump.fun shipped "Custom Pairs" on 9 Sep 2026:** 93 allowlisted quote assets, reportedly including metals [U]. That is a direct competitor, but it is not a platform you can build on.
- **A custom program is not justified.** Jupiter says it isn't adding custom launchpads to its screener because of an integration backlog, so the curve phase of your tokens would be hard to find.
- **Recommendation:** Meteora DBC + DAMM v2, with your own small "fee router / distributor" program set as `fee_claimer`, and time-weighted off-chain accounting paid out by Merkle claim or keeper push. **Confidence about 80%.**

---

## A. Meteora Dynamic Bonding Curve (DBC) + DAMM v2

### Custom quote token support: YES, no permission needed for classic SPL [C]
- `create_config` takes `quote_mint`, and every pool made from that config is paired with it ([configs doc](https://docs.meteora.ag/developer-guide/guides/dbc/bonding-curve-configs)).
- The on-chain check `is_supported_quote_mint` returns true immediately for any mint owned by the classic Token program. For Token-2022 it accepts only `MetadataPointer` and `TokenMetadata`, and it rejects Token-2022 wrapped SOL ([`utils/token.rs`](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/main/programs/dynamic-bonding-curve/src/utils/token.rs)).
- DBC v0.2.1 (the latest changelog entry) adds a **token badge**: Meteora operators can whitelist Token-2022 quote mints with other extensions. A non-zero transfer fee is never allowed (`QuoteMintHasNonZeroTransferFee`) ([CHANGELOG](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/main/CHANGELOG.md)).
- **Consequence:** existing Token-2022 gold tokens with compliance extensions would need a badge from Meteora. PAXG on Solana uses Permanent Delegate ([Paxos](https://www.paxos.com/blog/bringing-paxg-to-solana)). **Issue your own GOLD as classic SPL** to stay permissionless.
- Migration of a custom-quote pool works. All DAMM v2 configs that DBC uses carry `CreatePoolWithoutMintValidation` ([DBC README](https://github.com/MeteoraAg/dynamic-bonding-curve), [DAMM v2 CHANGELOG](https://github.com/MeteoraAg/damm-v2/blob/main/CHANGELOG.md)).

### Config keys, partner and fees [C]
- A partner config is created by the partner ([config doc](https://docs.meteora.ag/developer-guide/guides/dbc/bonding-curve-configs)). It covers:
  - fees: base fee (linear or exponential scheduler; rate-limiter mode deprecated in v0.2.1) and an optional dynamic fee
  - `collectFeeMode`: 0 = quote token, 1 = output token
  - `creatorTradingFeePercentage`
  - migration option and migration fee
  - LP split: partner/creator, locked/unlocked
  - vesting, token authority and `migrationQuoteThreshold`
  - `pool_creation_fee` in SOL, 0.001–100 SOL, of which Meteora takes 10%
- **Fee split** ([fees overview](https://docs.meteora.ag/core-products/dbc/fees/overview.md), [`constants.rs`](https://github.com/MeteoraAg/dynamic-bonding-curve/blob/main/programs/dynamic-bonding-curve/src/constants.rs)):
  - The protocol takes a **fixed 20%** of the trading fee. Referral/host fees come out of that 20%.
  - The remaining 80% is split partner/creator by `creator_trading_fee_percentage`.
  - Minimum base fee is 0.25%; maximum is 99%.
- **Claim timing:** "Partner, creator, and protocol trading fees can be claimed as they accrue; they do not need to wait for migration" ([fees overview](https://docs.meteora.ag/core-products/dbc/fees/overview.md)).
  - `claim_trading_fee` has no cooldown or time gate. It only checks that the signer equals `config.fee_claimer` ([`lib.rs`/`access_control.rs`](https://github.com/MeteoraAg/dynamic-bonding-curve)).
  - **So a PDA of your program can be `fee_claimer` and claim by CPI as often as you like, per pool.**
- **Curve:** up to 16 `{sqrtPrice, liquidity}` points (`MAX_CURVE_POINT = 16`; the README says up to 20 in config) [C].
  - SDK helpers: `buildCurve`, `buildCurveWithMarketCap`, `buildCurveWithTwoSegments`, `buildCurveWithMidPrice`, `buildCurveWithLiquidityWeights`, `buildCurveWithCustomSqrtPrices` ([SDK repo](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk), v1.5.12 in package.json, commit dated 7 Sep 2026).

### Migration to DAMM v2 [C]
- DAMM v1 migration is deprecated for new configs in v0.2.1, so DAMM v2 is the path.
- A 0.2% protocol liquidity migration fee applies.
- `migrationFeeOption` 0–5 means 0.25%, 0.3%, 1%, 2%, 4% or 6%. Option 6 is a custom fee, DAMM v2 only, bounded 10–1000 bps.
- The migration fee (0–50% of quote) can be split with the creator.
- At least 10% of liquidity must stay locked for at least 1 day.
- LP percentages (partner/creator × locked/unlocked) must sum to 100%. There is no burn, so **100% of post-graduation LP fees can go to the partner PDA.**
- Position NFTs go to `config.fee_claimer` and `virtual_pool.creator` (`migrate_damm_v2_initialize_pool.rs`). Locked or permanently locked positions still claim fees ([DAMM v2 overview](https://docs.meteora.ag/overview/products/damm-v2/what-is-damm-v2)).
- DAMM v2 itself keeps 20% as protocol fee ([`cp-amm/constants.rs`](https://github.com/MeteoraAg/damm-v2)).
- Migrated pools can use:
  - a market-cap fee scheduler or a time scheduler ([market-cap scheduler](https://docs.meteora.ag/core-products/damm-v2/fees/market-cap-scheduler.md))
  - a dynamic fee
  - "Compounding" collect mode
  - 2 built-in reward (farming) slots
- **Migration is permissionless** (any payer).
- Meteora's keepers only auto-migrate SOL, USDC or JUP pools, or "USD-equivalent" quotes at 750 USD or more ([integration intro](https://docs.meteora.ag/developer-guide/integrations/dbc/1-introduction)). **For GOLD, run your own migration keeper** or use the Manual Migrator [C/U: whether GOLD counts as "USD-equivalent" is unknown].

### SDK and CPI [C]
- **TypeScript:** `@meteora-ag/dynamic-bonding-curve-sdk`, actively maintained.
- **Rust:** `dynamic-bonding-curve = { git = ..., features = ["cpi"] }` ([CPI doc](https://docs.meteora.ag/developer-guides/dbc/rust-integration/cpi.md)).
  - Fee claims are called a "good fit" for CPI.
  - Swaps via `swap2` work; the instructions sysvar is needed when the anti-sniper min-fee flag is on.
  - For migration, Meteora recommends SDK-built transactions.
- **Launch toolkit:** [Meteora Invent](https://github.com/MeteoraAg/meteora-invent).

### Other Meteora pieces
- **Dynamic Fee Sharing** (`dfsdo2Uq…`): splits among a **fixed 2–5 recipients**. It is **not a holder distributor**, but PDA vaults can be funded directly from DBC or DAMM v2 claims ([what it is](https://docs.meteora.ag/helper-products/dynamic-fee-sharing/what-is-dynamic-fee-sharing.md), [design guide](https://docs.meteora.ag/helper-products/dynamic-fee-sharing/design-guide.md)) [C]. It's a candidate for a platform/treasury split, not the 40% to holders.
- **Alpha Vault:** pro-rata and FCFS modes ([modes](https://docs.meteora.ag/anti-sniper-suite/alpha-vault/alpha-vault-modes)). Docs mention SOL/USDC deposits. **DBC compatibility and custom-quote deposits are not confirmed [U].**
- **Launch Pool** docs: [DBC token launch pool](https://docs.meteora.ag/invent/launch-pools/dbc-token-launch-pool.md). There is also a Presale Vault and the legacy Stake2Earn ([llms.txt index](https://docs.meteora.ag/llms.txt)).
- **Transfer hooks on the base token (v0.2.0):** supported, but **the hook program and authority are revoked after the last curve swap** (`process_swap.rs`). DAMM v2 only accepts TransferHook mints whose hook is null (`is_permissionless_supported_mint`) [C]. So hooks can't track holders after graduation.

### Audits [C]
- DBC: Offside Labs (v0.1.1–v0.2.0), Zenith (v0.1.1–v0.2.0), OtterSec (v0.1.3) ([DBC audits](https://docs.meteora.ag/resources/audits/dbc)), plus a Code4rena contest Aug–Sep 2025 with 0 High and 2 Medium findings ([C4 report](https://code4rena.com/reports/2025-08-meteora-dynamic-bonding-curve)).
- **v0.2.1 (token badge) is not in the published audit list [U].**
- DAMM v2: Zenith, Offside (up to v0.2.2), OtterSec ([DAMM v2 audits](https://docs.meteora.ag/resources/audits/damm-v2)).

### Launchpads built on it
- Jupiter Studio, Believe, Bags, Moonshot "and like 20 more" (as of Aug 2025) ([Meteora on X](https://x.com/MeteoraAG/status/1957277304851447883)).
- Bags runs its own **Fee Share V1/V2 programs** on top of DBC and DAMM v2 ([Bags program IDs](https://docs.bags.fm/principles/program-ids)). This is the architecture I recommend [C].

## B. Raydium LaunchLab

- **Custom quote:** a quote mint is bound through a `GlobalConfig`, which "can be created and updated by either the LaunchLab program admin or the delegated create-config authority; any other signer gets InvalidOwner" ([global config](https://docs.raydium.io/products/launchlab/global-config)) [C].
  - Token-2022 quote mints have been allowed since 24 Aug 2026, with **no extension screening**: "the only gate is which mints an admin binds" ([changelog](https://docs.raydium.io/reference/changelog/2026-08-24-launchlab-token2022-quote-mint.md), [T22 reference](https://docs.raydium.io/reference/token-2022-support)).
  - Raydium announced "any token pair" on 7 Sep 2026 with StonkFun as first partner ([crypto.news](https://crypto.news/raydium-launchlab-adds-support-for-any-token-pair-on-solana/)). **Whether third parties can get a GOLD config self-serve is unconfirmed [U]. Assume you'll need Raydium's cooperation.**
  - Migration (`MigrateToCpswap`) must be signed by the GlobalConfig's `migrate_to_cpswap_wallet`, which Raydium runs ([instructions](https://docs.raydium.io/products/launchlab/instructions)) [C].
- **Platform config:** anyone can create one [C] ([platform config](https://docs.raydium.io/products/launchlab/platform-config)).
  - `fee_rate` is capped at 500 bps (since 26 Aug 2026). `creator_fee_rate` is capped at 50 bps.
  - Fees are additive on top of Raydium's 0.25% protocol fee ([fee reference](https://docs.raydium.io/raydium/build/tips-and-gotchas/launchlab-and-cpmm-fee-reference)).
  - Platform fees accrue per quote mint and are claimed with `ClaimPlatformFee` at any time.
  - A per-platform allowlist and curve rules exist.
- **Migration:** CPMM only since 17 Aug 2026.
  - The LP split is `platform_scale + burn_scale`; `creator_scale` is forced to 0.
  - The platform receives a Fee Key NFT for its locked share.
  - Only the platform's locked slice of the CPMM LP fee (84% of the trade fee) reaches you. The burned share's fees stay in the pool.
  - `platform_cp_creator` can redirect the CPMM creator fee to a platform PDA ([redistribution guide](https://docs.raydium.io/products/launchlab/tips-and-gotchas/redistribute-creator-fees.md)).
- **Token-2022 base mint:** transfer fee up to 5% allowed. The platform holds the withdraw-withheld authority ([T22 reference](https://docs.raydium.io/reference/token-2022-support)) [C]. This is the mechanism behind StonkFun's "reward launches" [U].
- **SDK and CPI:**
  - `@raydium-io/raydium-sdk-v2` is at 0.2.68-alpha (repo, 11 Sep 2026) and still carries the "alpha" tag.
  - A `launch-cpi` crate exists in [raydium-cpi](https://github.com/raydium-io/raydium-cpi) with initialize, buy/sell, claim_platform_fee and claim_creator_fee [C].
  - **The LaunchLab program source is not public** ([program addresses](https://docs.raydium.io/reference/program-addresses)) [C].
- **Audit:** Halborn Q2 2025, `raydium_launch.pdf`, in the [raydium-docs audit folder](https://github.com/raydium-io/raydium-docs/tree/master/audit) [C]. **No public audit covers the Aug–Sep 2026 upgrades [U].**
- **Who uses it:**
  - bonk.fun (with USD1 pairs) ([crypto.news](https://crypto.news/bonk-fun-integrates-usd1-stablecoin-through-raydium/)).
  - **StonkFun:** stock-, ETF- and crypto-paired memecoins, moved to LaunchLab on 5–6 Sep 2026 ([The Block](https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter-413621), [Bitquery](https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/), [Coinmonks](https://medium.com/coinmonks/stonkfun-api-track-stock-paired-solana-launches-in-real-time-d21777fc7412), [Cryptopolitan](https://www.cryptopolitan.com/raydium-ray-stonkfun-launchlab-buybacks/)).
  - StonkFun previously used direct CLMM pools, not DBC or its own curve [U].

## C. Jupiter Studio and routing

- **Studio is built on Meteora DBC** (program `dbcij3…`), migrating to DAMM v2 ([Bitquery](https://docs.bitquery.io/docs/blockchain/Solana/jupiter-studio-api/), [Studio docs](https://docs.jup.ag/user-docs/launch/studio)) [C].
  - The Studio API ([create token](https://developers.jup.ag/docs/studio/create-token)) takes USDC, SOL or JUP as quote. **No custom quote, and no partner config for you [C].**
  - Use DBC directly instead.
- **Routing** ([market listing](https://developers.jup.ag/docs/swap/routing/market-listing.md)) [C]:
  - "New markets created on supported DEXes are listed automatically."
  - Meteora DBC, DAMM v2, Raydium LaunchLab, CPMM and pump.fun all get instant routing.
  - Bonding-curve markets that don't graduate within the grace period (about 30 days) are dropped.
  - Liquidity test: a $500 round trip must lose less than 30%, or pass the fallback price-impact test.
- **GOLD caveat:** for a SOL buyer to reach a MEME/GOLD pool, the route is SOL → GOLD → MEME. That needs a deep, routable GOLD pool. With `restrictIntermediateTokens`, Jupiter only routes through "highly liquid intermediate tokens" ([get-quote](https://developers.jup.ag/docs/swap/v1/get-quote.md)) [U whether GOLD would qualify].
- **Custom AMMs** need an `Amm` trait implementation, SDK fork rights, an audit and traction ([integration](https://developers.jup.ag/docs/swap/routing/amm/integration.md)).
- **Jupiter Pro screener:** only launchpads "built on existing technologies like Meteora DBC"; custom launchpads are not being added ([Jupiter support](https://jupiverse.zendesk.com/hc/en-us/articles/22624842790812-How-can-I-get-my-launchpad-listed-in-the-Launchpad-Screener)) [C].

## D. pump.fun / PumpSwap (baseline only)

- **Custom Pairs launched 9 Sep 2026:** 93 quote assets (xStocks, Backpack/Sunrise stocks, wBTC/ETH, "metals"). They appear to be allowlisted by pump.fun, not arbitrary [U]. Pairings are permanent. Creator fee is 0.05–1%, split across up to 10 recipients. 50% of revenue goes to PUMP buyback ([The Defiant](https://thedefiant.io/news/defi/pump-fun-lets-creators-launch-coins-priced-in-tokenized-stocks), [Cryptowisser](https://www.cryptowisser.com/news/pumpfun-lets-creators-pair-new-tokens-with-tokenized-stocks/)).
- **Fees** ([pump fees](https://pump.fun/docs/fees)) [C]:
  - Curve: 1.25% total (0.30% creator, 0.95% protocol).
  - PumpSwap: tiered by market cap for SOL and USDC pairs.
- Fee sharing to up to 10 wallets arrived in Jan 2026 ([The Block](https://www.theblock.co/news/markets/2026-01-09-pump-fun-overhauls-creator-fees-token-launches-highest-daily-september-384975)).
- **No partner or platform layer: you can't run your own launchpad on pump.**
- Holder payouts on pump are done by third parties, e.g. SP500 routes creator fees into SPYx that holders claim pro rata ([AirdropAlert](https://airdropalert.com/blogs/tokenized-stock-airdrops/)) [U].

## E. Custom Anchor program

- **Scope:**
  - curve math (virtual constant product plus segments)
  - buy/sell with slippage and anti-snipe
  - graduation, with a CPI into DAMM v2 (classic SPL is permissionless there) or Raydium CPMM
  - LP lock and fee claim
  - fee vaults and the distributor
- Rough size is 3–6k nSLOC (my estimate) and 3–5 months of engineering.
- **Audit pricing, 2026 (secondary sources):**
  - Accretion: $7–20k for simple programs (500–2k nSLOC), $20–60k for standard DeFi (2–6k), $60–100k for complex, $100–150k+ for critical infrastructure. Typical rate is $15–45k per week, with a 20–100% rush premium ([Accretion](https://accretion.xyz/blog/solana-audit-cost)).
  - Sherlock: Rust/Solana costs 25–40% more than Solidity. A realistic mid-complexity budget is $60–120k including one fix review; re-audits run $5–20k per pass ([Sherlock](https://sherlock.xyz/post/smart-contract-audit-pricing-a-market-reference-for-2026)).
  - **Firm-specific quotes (OtterSec, Neodyme, Zellic, Sec3) aren't published [U].** Expect top-tier firms at the upper end, with a 4–10 week lead time (my estimate).
- **Estimate for a custom curve plus distributor:** $60–150k and 6–10 weeks of audit calendar time, plus about 4 months to build.
- **Main problem is distribution, not cost.** You'd have to negotiate one by one for Jupiter screener listing and for Axiom, Photon and GMGN to index the curve phase.

## F. Fee-to-holders mechanism

| Option | Works on Solana? | Verdict |
|---|---|---|
| Token-2022 **transfer fee** on the meme token | DBC base mints can't have it. LaunchLab base allows up to 5% [C] | Fee is paid in the **meme token, not GOLD**, so you must sell it into GOLD (sell pressure, MEV). It also taxes wallet-to-wallet transfers, and it isn't a trading fee. Not a fit for "40% of trading fees in quote". |
| Token-2022 **transfer hook** that settles a reward-per-share on each transfer | DBC revokes the hook at graduation. DAMM v2 and Raydium CPMM reject active hooks [C] | **Not practical.** It dies exactly when most volume starts. |
| On-chain staking (lock to earn, e.g. Streamflow) | Yes ([Streamflow staking](https://streamflow.finance/staking)) | Only pays stakers, not every holder. Reward in a different token than staked is [U]. |
| **Off-chain indexer + keeper (push)** | Yes. Bags pays its top 100 holders daily ([dev.to](https://dev.to/sivarampg/bagsfm-the-solana-launchpad-thats-changing-creator-monetization-4g7n)). Robinhood-chain projects pay every 15 minutes ([AirdropAlert](https://airdropalert.com/blogs/tokenized-stock-airdrops/)) | Works. Cost is driven by creating a GOLD token account for each new holder (about 0.002 SOL rent, my figure) plus about 5,000 lamports per transaction. Needs dust thresholds. |
| **Off-chain time-weighted balances + Merkle root on-chain, holders claim (pull)** | Yes (Jito/Streamflow-style distributors; [Streamflow airdrops](https://streamflow.finance/blog/how-to-do-a-solana-airdrop)) | **Recommended**, optionally with keeper push above a threshold. Verifiable, cheap, and time-weighting stops people from buying just before a snapshot. |

**Fee math on DBC:**
- Say the fee is 1.25%. Meteora takes 20% (0.25%).
- Set creator share to 25% of the remaining 80%, so the creator gets 0.25%.
- The partner PDA gets 0.75% and sends 0.50% (**40% of gross**) to the holder vault and 0.25% to the platform.
- After graduation, the partner PDA holds the LP NFTs (up to 100% of LP) and claims 80% of DAMM v2 LP fees, from which it routes 40% of gross.
- Set `collectFeeMode = QuoteToken` so everything arrives in GOLD.

## Comparison

| Criterion | Meteora DBC + DAMM v2 | Raydium LaunchLab + CPMM | Custom Anchor program |
|---|---|---|---|
| Custom quote token | **Permissionless for classic SPL**; Token-2022 with extensions needs a Meteora badge; no transfer fee allowed [C] | **Admin or delegated authority must create a GlobalConfig**; Token-2022 allowed, not screened [C]; "any pair" announced, self-serve unclear [U] | Anything you want |
| Fee-split flexibility | Fixed 20% protocol; 80% partner/creator split you configure; fees in quote; claim anytime; PDA claimer works; post-grad LP 100% to partner/creator, no burn [C] | Additive: 0.25% protocol + platform ≤5% + creator ≤0.5% + referral; claim anytime; post-grad only the platform's locked LP slice plus CPMM creator fee (Raydium's tiers) [C] | Fully flexible |
| Holder distribution | High: PDA `fee_claimer` → distributor (Bags pattern) [C] | Medium-high: platform-fee PDA + `platform_cp_creator`; StonkFun's transfer-fee rewards are in the base token [C/U] | High, but you build and audit all of it |
| SDK maturity | TypeScript SDK 1.5.12, Rust CPI crate, Invent scaffold, very active (commits 7–9 Sep 2026) [C] | SDK v2 still "0.2.68-alpha"; CPI crate; **closed-source program** [C] | None |
| Audit status | Multiple audits (Offside, Zenith, OtterSec) + Code4rena; v0.2.1 not listed [C/U] | Halborn Q2 2025; 2026 upgrades not publicly audited [C/U] | $60–150k, 6–10 weeks [U] |
| Integration effort | ~4–8 weeks: config + fee router (~1k nSLOC, ~$10–30k audit, my estimate) + migration keeper + indexer | Similar, plus Raydium business development for a GOLD config; Raydium runs migration | 4–6 months + audit + indexing negotiations |
| Jupiter / terminals | Instant Jupiter routing; screener prefers DBC; Meteora says Axiom, Photon, GMGN, BullX trade DBC pools [C] | Instant Jupiter routing [C]; terminal support for non-SOL quotes varies [U] | Not routed until integrated; Jupiter screener closed to custom launchpads [C] |
| Notable users | Jupiter Studio, Believe, Bags, Moonshot, ~20+ others | bonk.fun, StonkFun | n/a |

## Recommendation (confidence about 80%)

1. **Build on Meteora DBC → DAMM v2.**
   - Issue GOLD as a **classic SPL mint**, or reuse an existing gold token only if it is classic SPL. If it's Token-2022 with extensions, you need a Meteora badge [C].
   - Seed a deep GOLD/USDC pool on DLMM or DAMM v2 so Jupiter can route SOL → GOLD → MEME.
2. **Deploy a small audited "fee router" program whose PDA is `fee_claimer`.**
   - It claims per-pool DBC fees and DAMM v2 position fees by CPI, and splits them 40% to a holder vault and the rest to platform (and creator, via `creator_trading_fee_percentage`).
3. **Pay holders with off-chain time-weighted balances and a Merkle root posted on-chain.**
   - Holders claim, and optionally a keeper pushes payouts every 15–60 minutes to holders above a dust threshold.
   - Exclude pool vaults, LP, burn and CEX addresses.
4. **Run your own migration keeper,** since GOLD likely isn't on Meteora's auto list.
5. **Main risks:**
   - DBC v0.2.1 audit status.
   - Terminals displaying GOLD-quoted pairs correctly (the Terminal app lists only 34 quote assets ([Terminalpedia](https://terminalpedia.com/ecosystem/tokenized-stocks-solana-terminal))).
   - GOLD liquidity for routing.
   - Direct competition from StonkFun and pump.fun Custom Pairs.
6. **Plan B:** Raydium LaunchLab, if Raydium commits in writing to a GOLD GlobalConfig. Choose it if a StonkFun-style partnership and Raydium's current momentum matter more than open source code and permissionless setup.
