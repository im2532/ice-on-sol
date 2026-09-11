# Research Report: Commodity/Stock-Paired Token Launchpads (commodites.market, stonk.fun, embercurve.fun)

**Research date:** 2026-09-11. All figures marked "confirmed" come directly from page fetches or cited news articles; anything inferred or uncertain is marked **[inferred]**.

---

## 1. commodites.market — Commodity Market Exchange (CME)

**Confirmed basics:** commodites.market operates as "Commodity Market Exchange" (ticker/token **$CME**), a permissionless launchpad for launching memecoins paired against real-world commodity reference prices, running on **Robinhood Chain** (a Robinhood-Crypto-built L2) using **Uniswap v4** pools. Docs: https://www.commodites.market/docs. X: **@launchonCME** (https://x.com/launchoncme — page itself blocked by robots.txt, but confirmed as the handle from site content and search results).

Robinhood Chain context (confirmed via Uniswap's own blog, https://blog.uniswap.org/robinhood-chain-is-live): Uniswap v2/v3/v4/UniswapX all run on Robinhood Chain from its launch; the chain also supports 24/7 tokenized "Stock Tokens." Uniswap's own native launchpad on this chain is a **separate product called Pools.trade** (launched Aug 5, 2026, per https://crypto.news/uniswap-launches-first-robinhood-chain-launchpad/), which is a plain memecoin launchpad (Crowd Launch / Instant Launch formats) with **no commodity-pairing feature and no relation to CME** — CME is a distinct, commodity-specific launchpad built on the same chain/DEX stack.

### Market lifecycle (V6 single-pool design)
- Each market mints **1,000,000,000 (1B) tokens, fixed supply**, all placed into a Uniswap v4 pool **at creation** — no separate "virtual curve then migrate" step (that was how the earlier V3–V5 architecture worked; those markets migrated to a real pool only once fully subscribed).
- **800,000,000 tokens (80%)** sit in a concentrated-liquidity "curve range" spanning from an opening market cap of **$5,000** up to a cap of **$35,000**.
- **200,000,000 tokens (20%)** sit in a "reserve range" positioned above the $35,000 cap price, so the market keeps quoting liquidity past the curve cap "with no cliff and no relaunch."
- Because it's real v4 liquidity from block one, "any router or terminal can trade it, day one."

### Commodity coin peg mechanism
- Each commodity coin (e.g., GLD = 1 troy oz of gold) is pegged via a **dedicated, single-sided Uniswap v3 pool**: liquidity sits on **one side only** — an ask of protocol-minted coin placed **one tick above (or below, for the buy side) the oracle/feed price**.
- Effect: "A buyer never pays below the oracle and a seller never receives above it" — the single-sided design prevents the coin from trading through its reference price in either direction.
- **Keeper repricing**: a keeper bot runs on a **60-second cadence**, checking whether the reference price has crossed a tick line or whether a side of the pool has run dry ("out of inventory" on one leg). When triggered, the keeper withdraws both ranges, relocates the (now-empty) position to the new price, and re-places the single-sided liquidity there.

### Price feeds and staleness
- Feed source depends on the commodity type:
  - Exchange-traded commodities (metals, energy, ag, livestock) → **front-month futures quotes**.
  - Fast-food items → **current published US menu price**.
  - CS2 skins → **lowest live market listing**.
  - In-game currencies (e.g., RSGP) → **median of cheapest real-availability offers**.
- Feed prices update **every 60 seconds when the underlying reference moves**.
- **Staleness limits**: live/fast-moving sources tolerate up to **6 hours** stale before some fallback/halt behavior; futures-based (slower) sources tolerate up to **72 hours**.

### Keeper cadences (full list, confirmed from docs)
| Function | Cadence |
|---|---|
| Price feed updates | 60 seconds |
| Peg pool repricing | 60 seconds |
| Market migrations | 15 minutes |
| Fee collection | 15 minutes |
| Holder payouts | 15 minutes |
| Treasury conversion | 15 minutes |

### Fee split (confirmed, consistent across home page and docs)
- **40%** of trading fees → paid directly to holders of the meme/commodity-paired token, denominated **in the commodity coin the market is paired to**, weighted by wallet balance.
- **30%** → buyback-and-burn of **$CME**.
- **30%** → protocol/"runs the exchange" revenue.
- **No creator fee share** is mentioned anywhere in the docs or launch flow (explicitly noted: "No creator share").
- Trading fee tier is creator-selectable at launch: **1%, 2%, or 3%**.

### Holder payout rules
- Automatic payout "in the commodity coin the market is paired with," gated by two thresholds: a market's **unpaid pool must reach ≥$100** before a payout run processes it, and each individual wallet must hold **≥$5** worth to receive a share. Payout cycle: every **15 minutes**.

### Basket markets
- A market can pair against **up to 5 commodity coins** simultaneously ("Basket · up to 5" option on the launch page), with creator-set weights, **minimum 5% per leg**.
- Post-migration, **each leg gets its own Uniswap v4 pool**, all opened at the same USD reference price.
- **Routing for baskets**: the router quotes each per-leg pool both at the full order size and at half size, fits a slippage curve to each quote, then **splits the order across the pools** to achieve the best blended execution price.

### Routing (single-coin markets)
Described flow: **ETH → USDG → commodity coin → pool** — i.e., ETH is swapped to USDG (a stablecoin) which is then routed into the commodity coin before entering the target market's pool.

### Contracts (Robinhood Chain — as surfaced in docs; addresses beyond $CME not given verbatim)
| Contract | Role |
|---|---|
| LaunchpadV6 | Current market creation / liquidity management |
| Fee Hook (V6) | Applies the creator-selected trading fee via a Uniswap v4 hook |
| Launch Router (V6) | Handles ETH↔USDG conversion and trade routing |
| Basket Router (V6) | Splits orders across multi-leg basket pools |
| Commodity Price Feed | Oracle covering all 94 commodities |
| $CME token | 0xe2324FF2a59F8eCBa8c321c6466e59121C00e795 (as reported on the site — **verify on-chain before relying on this**, since WebFetch-extracted addresses can be OCR/parse errors) |
| $CME Buyback contract | Executes and burns bought-back $CME |

### UI structure
Top-level nav: **Markets, Commodities, Launch, Rewards** (plus Docs).
- **Markets** page: lists all live markets (attempted direct fetch of `/markets` returned a 404 on this pass, so exact column layout wasn't independently re-verified this session — home page states markets/stats are surfaced there).
- **Commodities** page: browsable list of all 94 commodities with category groupings and live reference price + unit (see full list below).
- **Launch** page (confirmed via fetch), a 3-step wizard:
  1. **Pairing**: choose "Single coin" (default GLD) or "Basket · up to 5."
  2. **Identity**: upload market image (PNG/JPEG/WebP, ≤5MB), set name/ticker, optional website/X/Telegram/description.
  3. **Fee & launch settings**: trading fee (1/2/3%), fee split display (40% holders in commodity coin / 30% CME buyback), and a **first-buy requirement** of a minimum $1 of ETH, auto-swapped into the paired commodity coin as the market's initial liquidity/first buy.
  - Overview panel shows: pairing commodity, supply (1B), opening cap ($5,000), curve cap ($35,000).
- **Rewards** page: presumably tracks holder payout history / claimable rewards **[inferred from nav label — not independently fetched]**.
- A commodity/market detail page presumably shows live chart, price, holders, fee accrual, and basket composition where applicable **[inferred from data model, not independently screenshotted]**.

### Traction (as of fetch date, self-reported on site)
- **624 markets** live, **94 commodities**, **$8.9M** 24h volume, **$14M** TVL, **~4K wallets** earning holder rewards.
- $CME: "graduated," 30% burn mechanism active, **4.45M CME burned (0.45% of supply)**, market cap **$10.79M**.
- 24h: **$74.4K** distributed to holders, **$36.2K / 13.813 ETH** spent on $CME buybacks.

### The 94 commodities (10 categories) — full extracted list
Note: the site states "94 commodities" and "10 categories"; the fetches captured **8 categories and ~87 named items** (Metals, Energy, Agriculture, Livestock, Fast Food, Drugs, CS2 Skins, Game Gold), plus references to "Pokémon trading cards" and other "Gaming/Collectibles" items in a separate category the crawl didn't fully enumerate. Treat the below as the confirmed subset, not necessarily the complete 94/10.

**Metals** (6): Gold GLD ($4,376.40/oz), Silver SLV ($64.38/oz), Platinum XPT ($1,792.50/oz), Palladium XPD ($1,295.75/oz), Copper HG ($6.53/lb), Aluminium ALI ($3,456.50/t)

**Energy** (6): WTI Crude CL ($101.61/bbl), Brent Crude BZ ($106.91/bbl), Oil fund USO ($156.81/unit), Natural Gas NG ($2.84/MMBtu), Gasoline RB ($3.20/gal), Heating Oil HO ($5.05/gal)

**Agriculture** (14): Lumber LBR ($579.50/mbf), Wheat ZW ($8.19/bu), Corn ZC ($5.34/bu), Soybeans ZS ($13.32/bu), Soybean Meal ZM ($356.90/ton), Soybean Oil ZL ($0.7197/lb), Rice ZR ($16.07/cwt), Oats ZO ($3.79/bu), Sugar SB ($0.1978/lb), Coffee KC ($2.90/lb), Cocoa CC ($5,941.00/t), Cotton CT ($0.8813/lb), Orange Juice OJ ($1.46/lb), Milk DC ($16.20/cwt)

**Livestock** (3): Live Cattle LE ($2.20/lb), Feeder Cattle GF ($3.27/lb), Lean Hogs HE ($0.8315/lb)

**Fast Food** (13): Big Mac BIGMAC ($5.91), 10pc McNuggets MCNUGS ($5.79), Whopper WHOPPER ($6.49), Chick-fil-A Sandwich CFA ($4.95), Crunchy Taco TACO ($1.89), Chicken Burrito BURRITO ($10.75), Grande Latte LATTE ($5.45), Large Pepperoni Pizza PIZZA ($12.99), Double-Double DBLDBL ($5.65), Baconator BACONATOR ($8.99), Popeyes Sandwich POPEYES ($5.99), Dunkin Medium Coffee DUNKIN ($2.99), Medium Fries FRIES ($3.79)

**Drugs** (12): Cocaine COKE ($100/g), Heroin HEROIN ($150/g), Methamphetamine METH ($20/g), Fentanyl Pill FENT ($5/pill), MDMA Pill MOLLY ($15/pill), Cannabis WEED ($10/g), LSD Tab ACID ($10/tab), Psilocybin Mushrooms SHROOMS ($10/g), Ketamine KET ($70/g), Crack Cocaine CRACK ($20/rock), Oxycodone 30mg OXY ($30/pill), Xanax Bar XAN ($5/bar)

**CS2 Skins** (12): AK-47 Redline, AWP Asiimov, AWP Dragon Lore, M4A4 Howl, Karambit Doppler, Butterfly Knife Fade, Desert Eagle Blaze, Glock-18 Fade, M4A1-S Printstream, Sport Gloves Vice, Operation Bravo Case, AK-47 Vulcan (prices $29–$10,064/item)

**Game Gold** (1+): OSRS Gold RSGP ($0.21/M gp) — likely more entries in this category not fully captured.

**Unconfirmed/partial categories**: "Gaming/Collectibles" (Pokémon cards mentioned by name but not itemized with units/prices), and at least one more category needed to reach the stated "10 categories, 94 commodities" total — **the crawl did not fully enumerate these; treat the 94-item/10-category claim as confirmed-by-site-copy but the full itemized list as incomplete.**

### Notable observations
- The commodity catalog notably includes hard-drug and weapon-skin "commodities," implying fully permissionless listing with no apparent content moderation — a potential regulatory/reputational flag worth noting.
- No team names, founders, or launch-date announcement were surfaced by search; only the @launchonCME X handle was identified (profile itself not directly readable due to robots.txt). **[gap — could not confirm team identity or exact launch date]**

---

## 2. stonk.fun — Solana Stock-Paired Token Launchpad

**Confirmed:** stonk.fun ("StonkFun") is a Solana launchpad for tokens "paired with memes, stocks, currencies, commodities & more," described on its own site with category filters including **xStocks, PreStocks, Tessera, Sunrise, Currencies, Leverage, and Collectibles**. Flagship native token: **$STONK**.

**Infra (confirmed):** Originally launched on its own bonding-curve mechanism, then **integrated with Raydium's LaunchLab** — confirmed by multiple sources:
- The Block: https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter
- Raydium's own X announcement: https://x.com/Raydium/status/2096316117799309714 — "StonkFun is now live on Raydium LaunchLab. Deeper liquidity, better fills, and fairer launches for new tokens on Solana's most battle-tested liquidity hub."
- The Block's X post: https://x.com/TheBlockCo/status/2096704326232342748
- On Sat. ~Sept 6, 2026, this Raydium LaunchLab integration triggered STONK to **jump 250% to ~$140M market cap**, pulling volume onto Raydium and Jupiter. Daily volume reportedly hit **~$135M** at peak.
- STONK reached an ATH of **$0.212**, later cooling to **~$95M** market cap.

**How stock-paired tokens work (confirmed):** The flagship $STONK token itself trades **against SPYx**, a Backed Finance–issued **tokenized S&P 500 tracker** (a synthetic/wrapped exposure product, not the real ETF) — meaning STONK's USD value reflects both S&P 500 index movement and STONK's own exchange rate vs. SPYx. This is the same general design pattern as CME (pairing a meme token against a reference-asset "coin"), but on Solana and against tokenized-equity trackers (xStocks-style, e.g., Backed's xStocks product family) rather than commodity futures. **Holding these tokens grants zero claim on underlying shares, no dividends, no shareholder rights** — explicitly flagged in coverage.

**Fee model (confirmed, partial):** Platform routes trading-fee revenue into **buybacks of $STONK on Jupiter, which are then burned**, verifiable on-chain. Exact fee percentage split (holder/creator/protocol) was **not disclosed** in any fetched source — the stonk.fun site itself gates fee documentation behind a "Revenue" page and a "Developers"/API page that weren't independently readable in this session (blocked by 403/robots on some attempts).

**Additional confirmed links from site:**
- Twitter: https://x.com/launchonsf
- Telegram: https://t.me/stonkfunxyz
- Launch page: https://www.stonkfun.xyz/launch
- Developer API: https://www.stonkfun.xyz/developers
- Rewards program: https://www.stonkfun.xyz/rewards
- Third-party data/API coverage: Bitquery's StonkFun API docs (https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/) and a Coinmonks/Medium writeup (https://medium.com/coinmonks/stonkfun-api-track-stock-paired-solana-launches-in-real-time-d21777fc7412) confirm third-party indexing of stonk.fun launches/trades/prices — evidence of meaningful ecosystem traction and tooling built around it.

**UI/branding (confirmed):** Dark theme (`#071013` background), sortable by market cap / newest / 24h volume — standard launchpad-style token grid. No explicit mascot was identified in the fetched content; "Stonk" wordmark branding only. **[gap — no confirmed mascot, no confirmed exact launch date beyond "recently, ~Sept 2026 news cycle"]**

**Related coverage for deeper context (not independently fetched this session, listed for completeness):**
- https://airdropalert.com/blogs/what-is-stonkfun/ ("StonkFun Explained: The Stock-Paired Launchpad That 3x'd in a Day")
- https://phemex.com/blogs/stonkfun-stonk-tokenized-stocks-trading (fetch blocked, 403)
- https://en.bloomingbit.io/feed/news/119825
- https://bingx.com/en/flash-news/post/stonk-jumps-in-hours-to-about-m-market-cap-after-stonkfun-adds-raydium-launchlab
- https://incrypted.com/en/stonk-surged-250-after-stonkfun-integrated-with-raydium/

---

## 3. embercurve.fun — Ember

**Confirmed:** Ember (embercurve.fun) is a Solana bonding-curve launchpad positioned as "**Launch a coin on Solana, paired with any stock**," drawing from a library described as **150+ tokenized-stock assets**. X account: **@embercurve** (https://x.com/embercurve — profile itself blocked by robots.txt, not independently read).

**Infra:** Built on **Meteora**, specifically the **Dynamic Bonding Curve (DBC)** program — confirmed indirectly: Meteora's own developer docs describe a "Fun Launch" scaffold (https://docs.meteora.ag/developer-guide/invent/scaffolds/fun-launch) as a toolkit for building launchpads exactly like Ember, wired directly to "Meteora's Dynamic Bonding Curve Program to create token pools with your DBC config key," plus built-in TradingView charts and Jupiter-API trading — a Next.js/TypeScript/Solana-Web3.js/Cloudflare-R2 stack. Ember's own page title references "Meteora DAMM v2 Launch," implying (consistent with Meteora's standard flow) that tokens **launch on DBC and graduate into a Meteora DAMM v2 pool** once the curve completes — this graduation mechanics detail is **[inferred by analogy to Meteora's documented standard DBC→DAMM v2 flow]** rather than confirmed verbatim on embercurve.fun itself, since the site's `/docs` page returned only meta-tag content on fetch (no body copy retrievable).

**Fee model (confirmed via site meta description):** Ember lets creators "**route 80% of fees to holders, burns, a SuperLotto, or your team**" — i.e., creators choose how to allocate an 80% fee share across four possible destinations: (1) token holders, (2) token burns, (3) a "SuperLotto" mechanism (apparently a lottery/jackpot fee-routing option — exact mechanics not documented in retrievable content), or (4) the creator's own team/treasury. The remaining ~20% presumably goes to the protocol **[inferred, not explicitly stated]**.

**Branding:** Dark theme (`#17191C`), "Ember" wordmark/fire branding implied by name; no dedicated mascot character was identified in fetched content.

**Token:** No distinct native Ember platform token (unlike CME's $CME or stonk.fun's $STONK) was identified — Ember appears to only facilitate launches of user-created coins paired against stock tokens, without its own governance/fee-share token. **[possible gap — could not confirm absence definitively]**

**Traction:** No volume/TVL/market-count figures were retrievable for Ember in this session — searches for Dune/DefiLlama dashboards specifically covering embercurve.fun did not surface dedicated analytics pages. **[gap]**

---

## 4. Other Solana Commodity/Stock-Pegged Launchpads (brief survey)

General searches for "solana commodities launchpad," "gold memecoin launchpad solana," and "commodity pegged tokens solana 2026" returned mostly **generic launchpad ranking/roundup content** (best-of lists) rather than named dedicated commodity-pegged competitors:
- https://solanacompass.com/projects/category/community/launchpads
- https://cryptoslate.com/launchpads/solana-launchpads/
- https://cryptonews.com/cryptocurrency/best-solana-launchpads/
- https://www.crawlux.com/blog/best-memecoin-launchpad/
- https://smithii.io/en/best-solana-launchpad/
- https://bitcoinfoundation.org/news/altcoins/best-memecoin-launchpads/

None of these surfaced a third named Solana-native, commodity-specifically-pegged launchpad distinct from stonk.fun/Ember (which are stock-paired, not commodity-paired) — **CME/commodites.market appears to be the primary commodity-pegged play, and it's on Robinhood Chain, not Solana.** On Robinhood Chain, the only other named launchpad found was **Pools.trade** (Uniswap's own, memecoin-only, no commodity pairing) and **Pons** (mentioned in a crypto.news headline — "Robinhood Chain launchpad Pons announces V2 with Uniswap V4 upgrade," https://crypto.news/robinhood-chain-launchpad-pons-announces-v2-with-uniswap-v4-upgrade/ — not independently investigated further this session).

**Meteora's own official "Launch Guide" (https://launch.meteora.ag/)** exists as a hub for DBC-based launchpads generally, which is the infrastructure Ember sits on; this is the likely template other Solana "stock/commodity-fun" clones (Ember included) are built from.

---

## Summary Comparison Table

| | commodites.market (CME) | stonk.fun | embercurve.fun (Ember) |
|---|---|---|---|
| Chain | Robinhood Chain (L2) | Solana | Solana |
| Underlying DEX/infra | Uniswap v4 (custom LaunchpadV6 + hooks) | Raydium LaunchLab (+ Jupiter routing) | Meteora Dynamic Bonding Curve (→ DAMM v2, inferred) |
| Paired asset type | 94 real-world commodities (metals/energy/ag/livestock/fast-food/drugs/skins/game-gold) via oracle-pegged "commodity coins" | Tokenized stocks/ETFs (xStocks/SPYx-style), currencies, other assets | 150+ tokenized stocks |
| Peg mechanism | Single-sided Uniswap v3 pool, 1 tick off oracle, 60s keeper repricing | Synthetic pairing vs. tokenized tracker (e.g., SPYx); no independent peg-repricing mechanism documented | Bonding curve only — no oracle peg; price is purely market-driven vs. paired stock token |
| Fee split | 40% holders (in commodity coin) / 30% $CME buyback-burn / 30% protocol; no creator cut | Undisclosed publicly; buyback-and-burn of $STONK confirmed | Up to 80% creator-directed (holders/burn/SuperLotto/team) |
| Native token | $CME | $STONK | None identified |
| Market cap / traction (as observed) | $10.79M ($CME mcap); 624 markets; $8.9M 24h vol; $14M TVL | ~$95–140M ($STONK mcap); ~$135M peak daily volume | Not disclosed |
| X handle | @launchonCME | @launchonsf | @embercurve |

---

### Full source list
- https://www.commodites.market/ , /docs , /commodities , /launch
- https://x.com/launchoncme (blocked — handle only)
- https://blog.uniswap.org/robinhood-chain-is-live
- https://finance.yahoo.com/markets/crypto/articles/uniswaps-pools-trade-launchpad-goes-163044791.html
- https://crypto.news/uniswap-launches-first-robinhood-chain-launchpad/
- https://crypto.news/robinhood-chain-launchpad-pons-announces-v2-with-uniswap-v4-upgrade/
- https://blog.uniswap.org/launch-aggregator-explore-top-uniswap-launchpads-in-one-place
- https://www.bankless.com/read/news/uniswaps-pools-trade-launchpad-goes-live-on-robinhood-chain
- https://www.stonkfun.xyz/ , /launch , /developers , /rewards
- https://x.com/launchonsf ; https://t.me/stonkfunxyz
- https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter
- https://x.com/Raydium/status/2096316117799309714
- https://x.com/TheBlockCo/status/2096704326232342748
- https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/
- https://medium.com/coinmonks/stonkfun-api-track-stock-paired-solana-launches-in-real-time-d21777fc7412
- https://airdropalert.com/blogs/what-is-stonkfun/
- https://bingx.com/en/flash-news/post/stonk-jumps-in-hours-to-about-m-market-cap-after-stonkfun-adds-raydium-launchlab
- https://incrypted.com/en/stonk-surged-250-after-stonkfun-integrated-with-raydium/
- https://en.bloomingbit.io/feed/news/119825
- https://phemex.com/blogs/stonkfun-stonk-tokenized-stocks-trading (fetch blocked, 403)
- https://embercurve.fun/ , /docs
- https://x.com/embercurve (blocked — handle only)
- https://docs.meteora.ag/developer-guide/invent/scaffolds/fun-launch
- https://github.com/MeteoraAg/dynamic-bonding-curve
- https://launch.meteora.ag/
- https://docs.sumo.trade/launch-tokens/meteora-dammv2-launch
- https://www.dextools.io/tutorials/what-is-meteora-dlmm-dynamic-bonding-curve-2026
- https://github.com/MadgicDev/solana-trade
- https://solanacompass.com/projects/category/community/launchpads
- https://cryptoslate.com/launchpads/solana-launchpads/
- https://cryptonews.com/cryptocurrency/best-solana-launchpads/

---

## Key gaps / things not confirmed
1. CME/commodites.market: team identity, exact launch date, full itemized list for the "Gaming/Collectibles" category and the remaining commodities needed to reach 94/10 categories, exact commodity market-detail page layout (couldn't independently fetch a live market URL), and exact contract addresses beyond the self-reported $CME address (not verified on-chain).
2. stonk.fun: exact fee-split percentages, mascot/branding specifics, precise launch date (site references suggest it predates the Sept 6, 2026 Raydium integration by some period, but the original launch date wasn't found).
3. embercurve.fun: exact fee percentages within the "up to 80%" figure, exact bonding-curve/graduation parameters, "SuperLotto" mechanics, and any traction/volume data.
4. No additional dedicated Solana commodity-pegged (as opposed to stock-pegged) launchpad was found beyond CME (which is not on Solana).
