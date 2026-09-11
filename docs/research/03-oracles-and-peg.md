# Solana Commodity Coins: Oracles, Peg Mechanism, Coverage and Risk (September 2026)

**Legend:** **[C]** means confirmed from a primary source during this research. **[U]** means uncertain, inferred, or from prior knowledge that was not re-checked.

**Bottom line:**
- **Oracle stack:** Pyth Core covers about 22 commodities. Switchboard on-demand covers the rest.
- **Peg mechanism:** don't copy the Uniswap two-position peg. Build a small custom Anchor "Peg Desk" that mints and burns at the oracle price plus a spread, in the style of Solana's prop AMMs, and then get it into Jupiter's router.
- **Collateral:** the protocol is structurally short every commodity it issues. Hold gold and silver reserves in real tokens (PAXG, XAUt0, XAUm) and cap supply on anything you can't hedge.
- **Launch list:** drop the drug coins.

**Note on the original:** the commodites.market homepage says it runs on **Uniswap v4** pools on Robinhood Chain, not v3. It lists 94 "commodities," launches markets at $5k market cap (bonding curve to $35k), and splits fees 40% to holders (paid in the paired commodity coin), 30% to $CME buyback and burn, 30% to the protocol **[C]** ([commodites.market](https://commodites.market)). Their "How it works" page returned a 404, so the keeper, tick and staleness details (60 s keeper, ±1 tick, 6 h / 72 h staleness, halt when stale) come from the brief and were not independently verified.

---

## 1. Commodity price feeds on Solana

### 1.1 Pyth Core (free, pull model through Hermes)

This is the full commodity and metal list from Pyth's own API **[C]**: [hermes.pyth.network/v2/price_feeds?asset_type=commodities](https://hermes.pyth.network/v2/price_feeds?asset_type=commodities) and [asset_type=metal](https://hermes.pyth.network/v2/price_feeds?asset_type=metal).

**Continuous or near-continuous index feeds (best for pegs):**

| Commodity | Symbol | Hours | Feed ID |
|---|---|---|---|
| Gold | `Metal.Index.GOLD/USD` | 24/7 | `fa0f57505be633c026896e15afef2c7ce2cf8ff9a45349d1da737f4f01266b01` |
| Silver | `Metal.Index.SILVER/USD` | 24/7 | `6afca47e1c79ecd0d2844327efb463478417a9d498dfb0915ce5e88ae6d952d3` |
| 1-oz Gold | `Metal.Index.1OZGOLD/USD` | 24/7 | `7fd2c87083dd8fd5af2486a43f40b8e444acd77fda4e96263a53421cd079c387` |
| Oil (Pyth blend) | `Commodities.Index.PYTHOIL/USD` | 24/7 | `67784f72e95ac01337edb7d7bd5bbd1c03669101b7068a620df228ed4e52ef14` |
| Brent | `Commodities.Index.BRENT/USD` | 24/7 | `f33ce961935076ef4dc98be75cf2126046eac1bffdcd7a0fa05ccf18b746fda6` |
| Natural gas | `Commodities.Index.NATGAS/USD` | 24/7 | `45f95717fbe158e896415d1cea33814d73e54169022a8f7bcbb815ebef92f71c` |
| Copper | `Commodities.Index.CU/USD` | 24/7 | `b2b238aeb6ef5a722c5cf278595bf40434e174cac4f88c8ad5b6f5009b548c59` |
| Copper | `Commodities.Index.COPPER/USD` | 23/5 | `4073f4c331bf7920a3887536093b57c78ea535e88ac09c761e5b949221c33414` |
| Dutch TTF gas | `Commodities.Index.TGAS/USD` | 23/5 | `3cdfe3c9fc024c8df6420ff50686224cfabffce99b9231a4d67ffb4475750d91` |

**Spot and LME feeds (follow market hours):**

| Commodity | Symbol | Feed ID |
|---|---|---|
| Gold spot | `Metal.XAU/USD` | `765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2` |
| Silver spot | `Metal.XAG/USD` | `f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e` |
| Platinum | `Metal.XPT/USD` | `398e4bbc7cbf89d6648c21e08019d878967677753b3096799595c78f805a34e5` |
| Palladium | `Metal.XPD/USD` | `80367e9664197f37d89a07a804dffd2101c479c7c4e8490501bc9d9e1e7f9021` |
| Aluminium (LME 3-month) | `Metal.AL3M/USD` | `9397ba38556359e78a52853b5db5e350e86b9e9a6c01094698130112f3d10cb6` |
| Copper (LME 3-month) | `Metal.CC3M/USD` | `719ab84313696fb0d166b7a34064ea5b4da8af2304ccc0b17ad8a881cdfca379` |
| Nickel (LME 3-month) | `Metal.NL3M/USD` | `9b7b94a8ccbde25ce0059535fd6f9afe77b5121ea20b0c64ccbad5b34be449b8` |
| Lead (LME 3-month) | `Metal.LE3M/USD` | `777b9fa77dfb15b2f3fbf63c2e7230535d01cad7dd3dcb19a607d93c72957f74` |

**Dated futures feeds (these expire, so the keeper has to roll them).** Complete list as returned by Hermes on 2026-09-11. Some front months shown have already expired or are about to; the keeper must track expiries.

| Symbol | Description | Unit | Feed ID |
|---|---|---|---|
| `Commodities.WTIV6/USD` | WTI 22 Sep 2026 | USD | `9526e04755ebaed86733913b84fe14db4ea165da8f40f97710014cd877fe545b` |
| `Commodities.WTIX6/USD` | WTI 20 Oct 2026 | USD | `f8c2191e76f7f4d5335e7f4e8f81ab0df6360d54ee020874222841894203e9d7` |
| `Commodities.WTIZ6/USD` | WTI 20 Nov 2026 | USD | `0a76185a3bd608f10216036ee37140112c1c296d4cba31c4e2822f44e8dc0433` |
| `Commodities.WTIF7/USD` | WTI 21 Dec 2026 | USD | `87f7b1af745a1a6affb67275f813c081a65a3ccd46729c6170284176b5077e9c` |
| `Commodities.CLLV6/USD` | CLL 21 Sep 2026 | USD | `ecacddec5f27519878a5afab9927382833108ba8b8db05375a9b4c72e1941a7b` |
| `Commodities.CLLX6/USD` | CLL 19 Oct 2026 | USD | `498cea0b191242f5fd97f2ff8339db3cb0833001656258261bd0ea1905f475c2` |
| `Commodities.CLLZ6/USD` | CLL 19 Nov 2026 | USD | `46ba8cfc6cb0be8d6203f2b5452548c500f184422e2da05ba12dc98df4f31328` |
| `Commodities.BRENTV6/USD` | Brent 28 Aug 2026 | USD | `6e3607735df0f027dc63890cc48055cccf1551003cc7a7c934cabe04485d1193` |
| `Commodities.BRENTX6/USD` | Brent 30 Sep 2026 | USD | `25b67e140c4f6683d86ddaea0efaa20a0c13722da04b16d60361ad0b05d0d394` |
| `Commodities.BRENTZ6/USD` | Brent 30 Oct 2026 | USD | `6db688b9ec9e90a3e53f75891c3581e29ba157edf2a9ae98dffb5e5b5e595742` |
| `Commodities.BLDV6/USD` | Brent last-day financial 28 Aug 2026 | USD | `f8620d6b85c68f92dcd447dc5200d9bc0d22d2577219db188762b55770daab9a` |
| `Commodities.BLDX6/USD` | Brent last-day financial 30 Sep 2026 | USD | `579e38caeab043906efec4cb4a93949d13466d8295d7eeaea36dc926f740a3d5` |
| `Commodities.BLDZ6/USD` | Brent last-day financial 30 Oct 2026 | USD | `3a25a8a021b5bf927a887f0152b7b1e068535ce2c859180f54e2a2b1dc39f85c` |
| `Commodities.NGDU6/USD` | HH natural gas 27 Aug 2026 | USD | `8805823f20690f7b1b138d912a1e6988dca4ed166c813118f8d05cbf00d61dce` |
| `Commodities.NGDV6/USD` | HH natural gas 28 Sep 2026 | USD | `466654d255f46e832bcbc6773aa64b000dff9b919be4ecd354af598cdb10cdf3` |
| `Commodities.HNV6/USD` | Henry LD1 natural gas 28 Sep 2026 | USD | `0c490b972a30f7da46275a254ea159f09335a52612c771c8a0e1849eef5c2f66` |
| `Commodities.HNX6/USD` | Henry LD1 natural gas 28 Oct 2026 | USD | `2f28c1dcf045be15f77ff6e91122d8695ae34e3babc730fc0d83f089a7ba08a6` |
| `Commodities.TGEU6/EUR` | Dutch TTF gas 27 Aug 2026 | **EUR** | `f7e3e0907ac5471a4af23ca5a7662db2506fb97c6164b03273c4c77d2cf25aab` |
| `Commodities.TGEV6/EUR` | Dutch TTF gas 29 Sep 2026 | **EUR** | `08091cec13e9f3888d078444fe13d2d5d6e169dad606bbca8a0542c080b5ed57` |
| `Commodities.TGEX6/EUR` | Dutch TTF gas 29 Oct 2026 | **EUR** | `a43a70231f5aca3698bbc5ff53cc3b008ec4882abbe2466655f07304b2fdeef8` |
| `Commodities.GOU6/USD` | LS Gasoil 10 Sep 2026 | USD | `fd786c36413bc6b02d5c7462b15c5230d6ba1339ddf2b93d88f14125bae57390` |
| `Commodities.GOV6/USD` | LS Gasoil 12 Oct 2026 | USD | `67ac99dbcd32ccfe426f959d26906d3ce66d96302fd812fb7a4a8cc03ccf5827` |
| `Commodities.WHU6/USD` | Wheat 14 Sep 2026 | **US cents** | `3b7340060c669c19f9285fab57649ac27a7c332eccaaf2d18e1db3a9c9c26141` |
| `Commodities.WHZ6/USD` | Wheat 14 Dec 2026 | **US cents** | `3f4760e9dcbaa7208a1d72af7edb1642681a48473c33100ee4e85aebf9a1b80f` |
| `Commodities.COU6/USD` | Corn 14 Sep 2026 | USD (per Hermes description) | `dca56b6f3f4a335a2f4e3b7b3338794710d1aa5779bdeb40059ead4b0854328b` |
| `Commodities.COZ6/USD` | Corn 14 Dec 2026 | USD (per Hermes description) | `417f8c1eef7f02018a1f62fa554046ab33cb7bd57dbb0b9a12ff01136c8556b1` |
| `Commodities.SOU6/USD` | Soybean 14 Sep 2026 | **US cents** | `6166cc35fc143015084c2814bfff87cf21bea4dfc231676bc843496c1cfcf239` |
| `Commodities.SOX6/USD` | Soybean 13 Nov 2026 | **US cents** | `20b5c568be5e8ac92de4db32c0353bf3d85104d2fd2954fe8cd62e6b59ff2516` |
| `Commodities.RSV6/USc` | Raw sugar 30 Sep 2026 | US cents | `083ec5425198db3a08d69ac2ac97fd8382bef92cd957526130f2daa48c1f9059` |
| `Commodities.CFU6/USc` | Coffee 18 Sep 2026 | US cents | `7ae20d255b4661f9cff4b135960fca84072860a4addbfb33ec51e1e83d3abea3` |
| `Commodities.CFZ6/USc` | Coffee 18 Dec 2026 | US cents | `a61c21c0ca93300f50f231b52f59e9a6f47a07d33e78c1a9b8f84bd5928a3e8f` |
| `Commodities.CAU6/USD` | Cocoa 15 Sep 2026 | USD | `6d11c359fb74f44283fe65303a37b06088d6a6a6cf52e7cedcde076132581a9e` |
| `Commodities.CAZ6/USD` | Cocoa 15 Dec 2026 | USD | `7452a0c6aa220280021272c3cebaaa0f32cc910cd14ea43460ff8ae2d1e773ea` |
| `Commodities.LCQ6/USc` | Live cattle 31 Aug 2026 | US cents | `99668a9e0f978d486c5b06456362c4090927310b1cf6926e11528e27e958118f` |
| `Commodities.LCV6/USc` | Live cattle 30 Oct 2026 | US cents | `38f7825b9a942b6ec6fd63cb9c6d2e6e9903170dce9aba353d279ad0e1172d83` |
| `Commodities.LCZ6/USc` | Live cattle 31 Dec 2026 | US cents | `7784095554ed1396c8b62ca4b1b9c6edfd5c5d82607e81acd3a04faf82a50a09` |
| `Commodities.CCU6/USD` | High-grade copper 28 Sep 2026 | USD | `e18f040343bc881281f3f210eafd20d0206e6a0d9ce572b94e71b118121c6416` |
| `Commodities.CCZ6/USD` | High-grade copper 29 Dec 2026 | USD | `b0608465d2f5e17fdd2097b9e32c76a31973d73971c0246a949599e8a2b4e414` |
| `Commodities.PTV6/USD` | Platinum 28 Oct 2026 | USD | `54a5a2a245da9b9188e4b448a7d35d7503adb660648ca108339e221cbb22e92a` |
| `Commodities.PDU6/USD` | Palladium 28 Sep 2026 | USD | `642a2a601c87c0b5689e0b649cbf6a7ab188edbed3a3ab4efe77abf77d0ef9a0` |
| `Metal.PDZ6/USD` | Palladium 29 Dec 2026 | USD | `ae8dab7e34e9e0f96cd68998c866cb613bf33f79d3a09fc79d6fd7211588250c` |
| `Metal.OGV6/USD` | 1-oz gold futures 28 Sep 2026 | USD | `c8aa9df34a4d12c66968d61873631856ec0b4d05ca9fbcbdaf883dc2fd1ada9c` |
| `Metal.OGZ6/USD` | 1-oz gold futures 25 Nov 2026 | USD | `19134abe3edbbaa88047e1658f7f25c70c68d9e90d54a77090f82ce67dfea1a4` |

Unit caveat: always read the `expo` from the price account and confirm the quote unit (cents vs dollars; EUR for TTF) before scaling. "CLL" contract identity was not verified **[U]**.

**Other related feeds [C]:**

| Asset | Symbol | Hours | Feed ID |
|---|---|---|---|
| Tether Gold | `Crypto.XAUT/USD` | 24/7 | `44465e17d2e9d390e70c999d5a11fda4f092847fcd2e3e5aa089d96c98a30e67` |
| Matrixdock XAUm issue price | `Crypto.Index.XAUM/USD` | 24/7 | `d7db067954e28f51a96fd50c6d51775094025ced2d60af61ec9803e553471c88` |
| Gold xStock | `Crypto.GLDX/USD` | 24/7 | `e7d1138d0083368634087268c64b7bea0b4101a6365f83915cba9e76a8364b96` |
| SPDR Gold Shares ETF | `Equity.US.GLD/USD` | market hours | `e190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca` |
| United States Oil Fund | `Equity.US.USO/USD` | market hours | `d00bd77d97dc5769de77f96d0e1a79cbf1364e14d0dbf046e221bce2e89710dd` |

**Not on Pyth Core:** RBOB gasoline, heating oil, soybean meal, soybean oil, rough rice, oats, cotton, orange juice, feeder cattle, lean hogs, milk, lumber, zinc and tin **[C: absent from the Hermes lists above]**. Pyth Pro may have more; its docs mention `Commodities.Index.LWTI1M/USD`, but the full list needs an API key **[U]** ([Pyth Pro feed IDs](https://docs.pyth.network/price-feeds/pro/price-feed-ids)).

**How Pyth works on Solana [C]** ([Solana pull integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana)):
- Anyone fetches a signed update from Hermes and posts it with the Pyth Solana Receiver into a `PriceUpdateV2` account. Your program then calls `get_price_no_older_than(max_age, feed_id)`.
- Full Wormhole verification takes several transactions. `addPostPartiallyVerifiedPriceUpdates` fits in one transaction but gives weaker guarantees.
- There are also fixed-address "price feed" (push) accounts maintained on shard 0, updated on a 55 s heartbeat or 0.5% deviation by default ([push feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana)). I could not see whether any commodity feeds are in that list, so assume you will run your own pusher **[U]**.

**Cost per update [U]:** you pay the Solana base fee (5,000 lamports per signature) plus priority fees, and the account rent comes back when you close it. My rough estimate is $0.001–0.02 per posted transaction depending on congestion, and one Hermes update can carry several feeds. Pyth Core data is free; Pyth Pro is a paid API-key subscription (price not published in its docs) and offers 200 ms and faster channels plus Solana Ed25519 verification ([Pyth Pro getting started](https://docs.pyth.network/price-feeds/pro/getting-started)) **[C for the features]**.

**Off-hours behaviour [C]:**
- Pyth says its feeds "follow the traditional market hours for each asset class," and that market hours "can cause price feeds to freeze" ([best practices](https://docs.pyth.network/price-feeds/core/best-practices)).
- Metals and WTI trade Sunday 6pm ET to Friday 5pm ET, with a daily 5–6pm break; Brent to Friday 6pm ET ([market hours](https://docs.pyth.network/price-feeds/core/market-hours)).
- So dated and spot feeds stop updating `publish_time` over the weekend, which is about 49 hours. That is why the original uses a 72 h staleness limit for futures.
- The 24/7 indices get around this. They draw on 125+ first-party publishers, including venues that trade off-hours:
  - Oil: launched in March 2026 ([BusinessWire](https://www.businesswire.com/news/home/20260317697899/en/Pyth-Network-Announces-Launch-of-First-Continuously-Updating-Oil-Price-Index)).
  - WTI and Brent indices: 17 June 2026; dYdX and Nado use them for oil perps ([Solana Compass](https://solanacompass.com/news/pyth-network-brings-crude-oil-pricing-on-chain-with-247-wti-and-brent-indices)).
  - Gold and silver indices: 24 June 2026 ([Solana Compass](https://solanacompass.com/news/pyth-network-adds-gold-and-silver-indices-giving-defi-247-pricing-for-safe-haven-assets)).
  - Pyth's 10 June 2026 release covers the wider index lineup (metals, oil, US equities; adopters include Coinbase, Kraken, dYdX, Nado) ([BusinessWire](https://www.businesswire.com/news/home/20260610193791/en/Pyth-Network-Launches-Proprietary-247-Index-Products-Across-Metals-Oil-and-U.S.-Equities-Partners-With-Marketvector-on-Equity-Index-Futures)).
- Pyth was also selected as resolution source for Kalshi's expanded commodities markets ([BusinessWire](https://www.businesswire.com/news/home/20260422753096/en/Pyth-Network-Selected-as-Resolution-Source-for-Kalshis-Expanded-Commodities-Markets)).

**Confidence intervals [C]:** every Pyth price comes as price ± conf ("(value ± confidence) × 10^exponent"). Pyth recommends using the band, or the EMA price, to defend against manipulation. The design below uses it to size a dynamic spread.

### 1.2 Switchboard (custom feeds pulling from any API)

**[C]** ([Solana basic feed](https://docs.switchboard.xyz/docs-by-chain/solana-svm/price-feeds/basic-price-feed), [llms-full.txt](https://docs.switchboard.xyz/llms-full.txt), [examples](https://github.com/switchboard-xyz/sb-on-demand-examples)):
- Jobs are built from `HttpTask` and `JsonParseTask` steps, plus WebSocket tasks and "variable overrides" that keep API keys secret while the source URL stays public.
- Oracles run inside TEEs and must pass a hardware proof to join the network.
- An update is two instructions (an Ed25519 signature check, then a store into a canonical quote account derived from the feed hash), and your program reads it in the same transaction.
- Settings include `max_age` (for example 30 slots, about 12 s), `min_oracle_samples`, `min_job_responses` and `maxJobRangePct`.
- Surge (WebSocket streaming, under 100 ms) is sold by subscription in SWTCH: a free "Plug" tier (10 s interval, 2 feeds), roughly $3k/month "Pro" (450 ms, 100 feeds) and roughly $7.5k/month "Enterprise" (300 feeds).

**[U]:** I found no published per-update fee for on-demand feeds on Solana. Assume Solana transaction fees plus a small oracle fee, and check on devnet.

Switchboard is the right tool for everything Pyth doesn't cover: the missing futures (through a licensed data vendor), CS2 skins, Pokémon cards and Big Mac prices.

### 1.3 Chainlink Data Streams on Solana

**[C]:**
- There is a Solana verifier for Data Streams, both on-chain and off-chain ([Solana on-chain verification](https://docs.chain.link/data-streams/tutorials/solana-onchain-report-verification), [off-chain](https://docs.chain.link/data-streams/tutorials/solana-offchain-report-verification)).
- The RWA schemas (v8 Standard, v11 Advanced) include a `marketStatus` field, and Chainlink says to "always use marketStatus to determine whether a market is open." v11 also carries mid, bid, ask and last-traded prices ([v11 schema](https://docs.chain.link/data-streams/reference/report-schema-v11), [v8 schema](https://docs.chain.link/data-streams/reference/report-schema-v8)).
- Metals and WTI streams follow NYMEX hours: Sunday 18:00 ET to Friday 17:00 ET, daily 17:00–18:00 break ([market hours](https://docs.chain.link/data-streams/market-hours)).
- GMTrade on Solana launched gold, silver and WTI perps on 1 September 2026 using "Chainlink Data Streams RWA Advanced (v11)" ([Solana Compass](https://solanacompass.com/news/gmtrade-opens-gold-silver-and-wti-crude-oil-perpetuals-on-solana-with-247-trading)). GMX-Solana also uses Data Streams ([GMX](https://gmxio.substack.com/p/gmx-solana-adopts-chainlink-data)).
- 24/5 equity streams (gold/silver via ETFs) since January 2026 ([CCN](https://www.ccn.com/news/crypto/chainlink-on-chain-trading-gold-silver-crypto/)).

**[U]:** It needs a subscription with no public pricing, and I could not find a public list of commodity streams beyond gold, silver and WTI. It's a good second source for the majors but not needed at launch.

### 1.4 Stork, RedStone, Edge

- **Stork [C]:** Solana is supported ("500+ assets on 70+ chains," [docs](https://docs.stork.network/)) through a pull model with a Rust SDK ([Solana API](https://github.com/Stork-Oracle/Documentation/blob/main/api-reference/contract-apis/solana.md)). On 13 May 2026 it launched **24/7** gold, silver, WTI and Brent feeds that switch to perp prices from Binance, Bitget, Hyperliquid, Lighter and OKX when markets are closed ([BusinessWire](https://www.businesswire.com/news/home/20260513610201/en/Stork-to-Deliver-Institutional-Grade-Price-Oracles-From-RWA-Perps-Markets-247), [The Block](https://www.theblock.co/post/401053/stork-24-7-price-discovery)). Access is sales-led and I found no prices **[U]**. It's a good weekend cross-check for the majors.
- **RedStone [U]:** the Solana push feed page I found shows only SOL, with "0 sources" ([page](https://app.redstone.finance/push-feeds/SOL/solanaMultiFeed)). I found no commodity feeds on Solana.
- **Edge (Chaos Labs) [U]:** it's a crypto-focused oracle used by Jupiter and Kamino ([Chaos Labs](https://chaoslabs.xyz/edge), [launch](https://chaoslabs.xyz/posts/introducing-edge-the-next-generation-oracle)), with no commodity coverage found. Not relevant here.

---

## 2. Novelty "commodities": data sources

| Category | Sources | Freshness | Notes |
|---|---|---|---|
| CS2 skins (AK Redline, AWP Asiimov, Dragon Lore, Howl, Karambit, Butterfly, Deagle Blaze, Glock Fade, Printstream, Vice, Vulcan, Bravo Case…) | Pricempire (40+ markets, 1-minute refresh, $120–240/month), cs2.sh (BUFF, Youpin, CSFloat, Skinport, Steam, C5; about 5 minutes; $75–200/month), CSGOSKINS.GG (36 markets, €179–279/month), SteamWebAPI, SteamApis (WebSocket), Steam's own `priceoverview` endpoint (heavily rate-limited) **[C]** ([comparison](https://cs2.sh/resources/best-cs2-skin-price-apis), [Pricempire](https://pricempire.com/api), [Skinstrack](https://github.com/SKINSTRACK/CS2-Price-API)) | Minutes | Actually fairly liquid. Use the median across 3+ markets and a fixed wear/float grade (for example Field-Tested). Steam prices include a roughly 15% fee and differ from BUFF/CSFloat, so pick one basis. Valve has acted against skin gambling sites before **[U]**. |
| OSRS gold ("RSGP") | Gray-market seller listings (PlayerAuctions, Eldorado, G2G): scrape the $/million-GP price **[U]** | Hours | Real-money trading breaks Jagex's terms. The data is low quality. |
| Pokémon cards and ETBs | pokemontcg.io (TCGplayer and Cardmarket prices; 1k/day keyless, 20k/day on a free key), tcgdex (1/7/30-day trends), tcgapi.net (bundles TCGplayer and PriceCharting plus eBay sold comps), pokemonpricetracker (graded, PSA/BGS/CGC) **[C]** ([ScrapingBee](https://www.scrapingbee.com/blog/pokemon-card-api/), [tcgdex](https://tcgdex.dev/markets-prices), [tcgapi.dev](https://tcgapi.dev/)). PriceCharting sits behind Cloudflare and needs a paid proxy. | Daily | Define the grade exactly (for example PSA 10 versus raw). Thin markets are easy to manipulate: one eBay sale can move a Charizard price 10%. |
| Big Mac | The Economist's big-mac-data on GitHub (code MIT, data CC-BY-4.0) **[C]** ([repo](https://github.com/TheEconomist/big-mac-data/blob/master/README.md)) | Twice a year | This is why the original shows +0.00%. |
| Other fast food (Whopper, nuggets, Baconator, etc.) | Scrape chain menus or delivery apps, or menu-price aggregators **[U]** | Weekly or manual | No licensed feed. Use a keeper-signed manual update. |
| Street drug prices | UNODC World Drug Report and EUDA/EMCDDA retail price tables (annual); crowdsourced sites such as priceofweed **[U]** | Annual | **Recommend excluding.** See §5. |

**How the keeper should source these:** build a Switchboard job per coin, with 2–5 `HttpTask` sources, a median, and API keys held in variable overrides. The keeper posts updates on a slow cadence (15 min for skins, 24 h for cards, manual for food) plus a deviation trigger.

For "manual" coins, use a `KeeperSignedPrice` account instead. It enforces a maximum move per update (for example ±5%), a minimum gap between updates, a multisig authority, and an on-chain source-hash note. Give these coins a matching long staleness window (for example 30 days for food) and a wider spread.

---

## 3. Peg mechanism on Solana

### 3.1 Why copying the Uniswap design is worse on Solana

The original quotes an ask one tick above the feed and a bid one tick below (about 1 bp each side) and relies on a keeper to reprice. That is a pure latency-arbitrage target:
- Real prices move between keeper updates (the 60 s cycle, weekends, futures rolls).
- Anyone watching Pyth or Hermes, or weekend perps on Hyperliquid, can buy the stale ask, then sell after the reprice. That drains the bid reserve.

Solana makes this worse. Jito bundles, and bots already reading Hermes in real time for prop AMMs, will pick off any stale bin within a slot. Robinhood Chain's first-come-first-served sequencer blunts some of this; Solana doesn't **[U, but structurally sound]**.

**The deeper issue is delta.** Every coin sold is a liability of `supply × price`, while the reserve holds only the USD collected. If gold rises 20%, the reserve covers about 83% of redemptions. "Bid runs dry" in the original is exactly this kind of depeg.

### 3.2 Comparison

| | Orca Whirlpools / Raydium CLMM | Meteora DLMM | Custom "Peg Desk" (oracle mint/redeem) |
|---|---|---|---|
| Fit for "ask above, bid below" | One-tick positions at tick spacing 1 (1 bp). Two positions to manage. | Very natural: coins in bins above the active bin, USDC in bins below, zero slippage inside a bin, even a limit-order mode; bin step up to 400 bps; 70 bins per array, positions up to 1,400 bins **[C]** ([DLMM docs](https://docs.meteora.ag/core-products/dlmm/what-is-dlmm)) | Exact: price = oracle × (1 ± spread), computed at execution |
| Capital efficiency | High, but inventory must be pre-minted and parked | High (bins); same pre-mint issue | Highest: mint on buy and burn on sell, so supply equals outstanding coins and no idle ask inventory |
| Keeper complexity | High: withdraw, close and reopen positions on every move; tick-array accounts | Medium–high: remove and add across bin arrays; dynamic fees can interfere | Low: push the oracle (or let the trade pull it); no repositioning at all |
| MEV / latency arbitrage | **Bad.** A stale position is a free option until the keeper lands; the keeper's own reprice can be front-run | **Bad** for the same reason | **Manageable.** Price is read in the same transaction; staleness, monotonic-timestamp and confidence gates; dynamic spread; flow caps |
| Depeg risk | Pools can be emptied and then trade freely off-peg | Same | Hard peg while the oracle is fresh and the reserve is solvent; halts cleanly |
| Jupiter routing | Automatic (the DEX is already integrated) | Automatic | **Needs integration**: implement `jupiter-amm-interface`, no network calls in quote, pass quote-parity tests (`jupiter-amm-test-kit`), show an audit, traction and a verifiable team **[C]** ([Jupiter docs](https://developers.jup.ag/docs/swap/routing/amm/integration), [interface](https://github.com/jup-ag/jupiter-amm-interface)). Prop AMMs using exactly this pattern already carry about 40% of Jupiter volume and about 30% of Solana DEX volume **[C]** ([Figment](https://www.figment.io/insights/the-rise-of-proprietary-market-makers-on-solana/)). |

**Recommendation:** use the custom Peg Desk as the primary venue, built like a prop AMM, with an on-chain price updated by cheap transactions ([LimeChain explainer](https://limechain.tech/blog/making-sense-of-prop-amms-on-solana), [Solana Compass on HumidiFi](https://solanacompass.com/learn/Lightspeed/how-humidifi-became-solanas-largest-prop-amm)). Until Jupiter integrates it, your frontend composes SOL→USDC (Jupiter) → COIN (Peg Desk) → MEME in one transaction.

Optionally, seed a thin, wide-spread Meteora DLMM COIN/USDC pool purely for discoverability. Keep it small, because it will be arbitraged.

**Coin mint:** make each COIN a **plain SPL token**, or Token-2022 with metadata only.
- Meteora DBC notes it "does not support any Token2022 extensions," though that note is about the base token and quote-token rules aren't spelled out **[U]** ([DBC configs](https://docs.meteora.ag/developer-guide/guides/dbc/bonding-curve-configs), [DBC repo](https://github.com/MeteoraAg/dynamic-bonding-curve)).
- Lattice launches coins on DBC paired with tokenized stocks that Meteora has "badged as a bonding-curve quote" ([latticepad.com](https://latticepad.com/)).
- Raydium LaunchLab supports any quote pair ([crypto.news](https://crypto.news/raydium-launchlab-adds-support-for-any-token-pair-on-solana/), [Raydium docs](https://docs.raydium.io/products/launchlab/overview)). That's the path StonkFun took ([The Block](https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter-413621)).

### 3.3 Design sketch: Peg Desk (Anchor)

**Accounts**

```
GlobalConfig        PDA["config"]       admin (multisig), keeper set, fee recipient, global pause,
                                        reserve_mint (USDC or USDG), max_oracle_conf_bps
Commodity           PDA["cmdty", sym]   coin_mint (mint authority = PDA), oracle_kind {PythPush, PythPull,
                                        Switchboard, KeeperSigned, Composite}, feed_id / feed accounts[],
                                        unit_scale (cents→USD, EUR→USD needs FX feed), max_age_open,
                                        max_age_closed, session calendar id, base_spread_bps,
                                        closed_spread_bps, conf_mult, supply_cap, per_slot_net_cap,
                                        per_tx_cap, last_used_publish_time, roll_state, status
ReserveVault        PDA ATA             USDC collected (per commodity, or shared with per-commodity accounting)
HedgeVault          PDA ATA (optional)  PAXG / XAUt0 / XAUm for GOLD, etc.
KeeperPrice         PDA["kp", sym]      for KeeperSigned/Composite: price, conf, publish_ts, source_hash,
                                        bounded-move params
SessionCalendar     PDA                 bitmap of open/closed windows (CME/ICE hours, holidays) set by admin
```

**Instructions**
- `buy(commodity, usdc_in, min_out)`
  - Read the oracle.
  - Require `now - publish_ts ≤ max_age(session)`, `publish_ts ≥ last_used_publish_time` (no cherry-picking older updates), and `conf/price ≤ max_conf`.
  - Set `ask = p·(1 + base + conf_mult·conf/p + age_penalty + session_add)`.
  - Mint coins, move USDC into the reserve, and enforce the caps.
- `sell(commodity, coin_in, min_out)`: the mirror of `buy` with `bid = p·(1 − …)`. Burn the coins and pay from the reserve. If `reserve < coin_in·bid`, pay pro-rata or revert, and emit an event.
- `keeper_update_price(sym, price, conf, ts, sig/quote)`: for KeeperSigned coins, with bounded moves. For Pyth and Switchboard, the keeper just posts to their receiver programs.
- `roll_contract(sym, next_feed_id, blend_schedule)`: for dated futures. Blend front and next month linearly over N days. Don't hard-switch: a 1–3% roll jump is a free trade for anyone who sees it coming.
- `set_params`, `pause(sym)`, `sweep_fees`, `rebalance_hedge` (admin or keeper; for example USDC→PAXG through Jupiter CPI).

**Keeper loop (off-chain, one per region, with a failover)**

```
every 1–5 s (open majors) / 30–60 s (others) / on deviation ≥ 0.1%:
  fetch Hermes batch for all live feeds → post (partially-verified) update to own push accounts
  fetch Switchboard quotes for custom feeds that are due → post
  check session calendar: flip Commodity.status Open/Closed/Halted
  if feed is a dated future and within roll window → update blend weights
  monitor reserve ratio = reserve_value / (supply × p); if < 102% → widen spread / cap buys;
      if < 98% → halt buys, alert
  hedge: net delta per commodity → rebalance HedgeVault or off-chain perp hedge
  land via Jito bundle or high priority fee (prop-AMM style); ALT for account lists
```

**Staleness policy (Solana version of the 6 h / 72 h rule)**
- Majors with a 24/7 Pyth index (gold, silver, oil, Brent, natural gas, copper): trade 24/7 with max age about 60 s and a normal spread.
- Majors whose dated or spot feed freezes (platinum, palladium, aluminium, grains, cattle):
  - Market open: max age 60–120 s.
  - Market closed: either halt, or keep a sell-only mode with a wide spread (1–3%) and tight caps.
  - Don't sell at a 48-hour-old price while Hyperliquid, Stork and Pyth weekend prices are moving.
- Novelty coins: set staleness to match the data's natural cadence (1 h for skins, 48 h for cards, 30 days for food), use a wide spread (1–3%), and cap supply hard.

**Cost [U]:** about 22 live feeds, batched roughly 5 per transaction, every 30 s comes to about 13k transactions a day. At about $0.005 each, that's roughly $65 a day. Tighter cadence scales linearly. Add $100–500/month in novelty data APIs.

---

## 4. Precedents and real tokens as quote

| Project | What it is | Status |
|---|---|---|
| **xStocks (Backed)** | 1:1-backed Token-2022 equities and ETFs (pausable, permanent delegate, transfer hook, scaled UI amount). Trade freely on DEXs; mint and redeem only for eligible non-US customers ([Solana case study](https://solana.com/news/case-study-xstocks), [products](https://xstocks.com/us/products)). Includes **GLDx** (SPDR Gold), sold on Kraken ([Kraken GLDx](https://www.kraken.com/xstocks/gldx), [Kraken xStocks](https://www.kraken.com/xstocks)). | [C] |
| **Ondo Global Markets** | 200+ tokenized stocks and ETFs on Solana since January 2026, including **IAU** (gold) and **SLV** (silver); US persons excluded ([MetaMask](https://metamask.io/news/metamask-adds-tokenized-us-stocks-etfs-and-commodities-via-ondo-global), [CoinDesk](https://www.coindesk.com/business/2026/01/21/ondo-finance-brings-200-tokenized-u-s-stocks-and-etfs-to-solana), [Solana](https://solana.com/news/ondo-global-markets-tokenized-stocks-etfs-solana), [SLVon on RWA.xyz](https://app.rwa.xyz/assets/SLVon)) | [C] |
| **Remora (rStocks and rMetals)** | 1:1 USDC-redeemable. rMetals covered gold (GLDr), silver (SLVr), copper (CPERr), palladium (PALLr) and platinum (PPLTr). Owned by Step Finance, whose treasury was hacked in January 2026; the page is written in the past tense ([Solana Compass](https://solanacompass.com/projects/remora-markets), [CoinGecko](https://www.coingecko.com/en/categories/remora-markets-tokenized-rstocks)). | [C] for the facts; current status [U] |
| **PreStocks** | Pre-IPO "price-exposure instruments" with no ownership rights; backing entities kept confidential; $545M volume; Jupiter limit orders ([SolanaFloor](https://solanafloor.com/news/pre-stocks-success-on-solana)) | [C] |
| **Bitget pre-IPO tokens** | SpaceX pre-IPO token on Solana, April 2026 ([CoinDesk](https://www.coindesk.com/business/2026/04/21/bitget-exchange-brings-pre-ipo-tokens-to-masses-starting-with-spacex-on-solana)) | [C] |
| **"pre.market"** | Couldn't identify this project. | [U] |
| **StonkFun** | Solana launchpad pairing memecoins with xStocks, "commodities" and other tokens through Raydium LaunchLab; $140M market cap and $135M daily volume on 6 September 2026. **This is your direct competitor.** Competitors on Robinhood Chain named as Long.xyz and Pons. ([The Block](https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter-413621), [explainer](https://airdropalert.com/blogs/what-is-stonkfun/), [Bitquery](https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/)) | [C] |
| **Lattice** | Meteora DBC launchpad quoted in 740 xStocks, 443 Ondo tokens and 19 Backpack tokens; mint authority revoked; graduates to locked DAMM v2 ([latticepad.com](https://latticepad.com/)) | [C] |

**Gold tokens on Solana:**
- **PAXG:** native Token-2022, launched 25 June 2026 with Sunrise ([Paxos](https://www.paxos.com/blog/bringing-paxg-to-solana), [Solana Compass](https://solanacompass.com/news/paxos-brings-pax-gold-to-solana-via-sunrise-making-paxg-the-first-occ-regulated-gold-token-on-the-network), [Sunrise](https://sunrise.xyz/press/2026-06-25-paxg-launch)).
- **XAUt0:** LayerZero OFT through Legacy Mesh since 15 October 2025 ([The Block](https://www.theblock.co/post/374786/tether-linked-usdt0-and-xaut0-launch-on-solana-via-layerzero-tech), [Cointelegraph](https://cointelegraph.com/news/solana-usdt0-xaut0-legacy-mesh-omnichain-launch)).
- **Matrixdock XAUm:** native since February 2026 ([Solana](https://solana.com/news/matrixdock-xaum-launch), [PR Newswire](https://www.prnewswire.com/apac/news-releases/matrixdock-expands-xaum-to-solana-enabling-institutional-grade-tokenized-gold-at-scale-302680931.html)).
- **Oro GOLD:** native, retail-heavy with about 10.7k holders ([Solana](https://solana.com/news/tokenizing-gold-inside-oro-s-vertically-integrated-bet)).
- Also GLDY, TER and GOLDX. Gold and silver token market cap on Solana grew 689% in the year to August 2026 ([Solana Compass](https://solanacompass.com/news/solanas-tokenized-gold-market-cap-grew-689-in-a-year-outpacing-every-other-chain)) **[C]**.
- KAU and AURA: I found no Solana deployment **[U]**.

**Could real tokens be the quote instead of synthetics?** For gold (PAXG, XAUt0, XAUm) and silver (SLVon) they could, and it removes both the oracle and the delta risk. The downsides:
- Token-2022 extensions (permanent delegate, pause) need launchpad support or a Meteora "badge." PAXG and xStocks are both Token-2022.
- The issuer can freeze or claw back tokens.
- Liquidity is thin.
- There is no clean oil, grain or cattle token on Solana. USO and similar ETF tokens, if listed, carry roll decay and trade only in market hours.

Use them as the **reserve and hedge asset** behind GOLD and SILVER, and keep your synthetic COINs as the uniform quote UX.

---

## 5. Regulatory and other risks

**US commodities law (CFTC)**
- A token whose payoff tracks a commodity price, with no delivery, sold to retail, is plausibly a **swap**. Non-eligible contract participants may only trade swaps on a registered exchange (a DCM).
- In 2023 the CFTC settled with Opyn ($250k), ZeroEx ($200k) and Deridex ($100k) for "swaps and leveraged or margined retail commodity transactions" offered without registration. It found Opyn's US IP blocking "not sufficient to actually block U.S. users" ([CFTC 8774-23](https://www.cftc.gov/PressRoom/PressReleases/8774-23), [Morgan Lewis](https://www.morganlewis.com/pubs/2023/09/cftcs-message-to-defi-platforms-register-with-the-cftc-or-leave-the-us-market-or-risk-enforcement)) **[C]**.
- A fully-paid, unleveraged synthetic is a grayer case than those. I'm treating the "swap" characterization as a material risk rather than settled law **[U]**.
- In the securities analogue, the SEC won in *Terraform*, where Mirror's synthetic stocks (mAssets) were treated as security-based swaps ([DLA Piper](https://www.dlapiper.com/en-us/insights/publications/2024/01/sec-secures-victory-against-terraform-labs-and-founder-do-kwon-key-takeaways), [Akin](https://www.akingump.com/en/insights/alerts/are-crypto-tokens-securities-terraform-court-says-yes-in-extensive-decision)).
- In 2026 the CFTC opened a path for onshore crypto perps. But its June 2026 policy statement wants formal Reg 40.3 review for perps on traditional commodities. Chair Selig said 24/7 perps are "not a natural fit for traditional commodity markets, like agriculture" ([Dechert](https://www.dechert.com/knowledge/onpoint/2026/6/cftc-takes-historic-steps-to-bring-digital-asset-perpetual-contr.html), [Grafa](https://grafa.com/en/news/crypto/cftc-chair-questions-perpetuals-for-commodities), [CoinDesk](https://www.coindesk.com/policy/2026/05/28/u-s-cftc-opens-crypto-perp-door-with-approval-of-first-regulated-firm), [Katten](https://katten.com/perpetual-futures-come-onshore-the-cftcs-new-regulatory-framework)) **[C]**. Expect scrutiny, not a safe harbor.

**How peers handle this**
- The issuers (xStocks, Ondo) exclude US persons and restrict mint and redeem through KYC [C].
- Launchpads (StonkFun, Lattice) lean on "memecoin, no claim on underlying" messaging ("Holding a stock-paired memecoin gives you zero claim on the underlying shares"). I found no documented geo-blocking **[U]**. Pump.fun blocked the UK in 2024 **[U, prior knowledge]**.

**Minimum posture:**
- Geo-block the US, UK and sanctioned countries on the frontend, knowing the CFTC called this insufficient.
- Offshore entity.
- No leverage.
- Disclose "synthetic, no claim on any commodity, redeemable only against the protocol reserve, may halt."
- Don't market the fee-share token (40% of fees to holders) as an investment; that is a Howey risk in its own right.
- Get counsel before launch.

**Drug coins: strong recommendation to exclude.** The original lists heroin, meth, fentanyl, molly, weed, acid, shrooms, ketamine, crack, oxycodone and Xanax.
- The price data is poor: annual UNODC/EUDA figures or darknet scrapes, which is itself problematic.
- It invites content and marketing bans across Jupiter's verified list, wallets, X and app stores, and payment on-ramps.
- Advertising controlled substances is regulated in several jurisdictions (UK, Singapore, UAE and others) **[U]**.
- Fentanyl in particular is politically radioactive in the US right now **[U]**.

**Trademark and IP:** Big Mac, Whopper, Baconator, Popeyes, Dunkin', Pokémon and card names, Valve and CS2 item names, and "CME" (a CME Group mark, which is also the original's ticker) all invite cease-and-desist letters **[U]**. Use generic names (for example BURGER, "CS-KNIFE-IDX", "ZARD-PSA10").

**Market-data licensing:** CME and ICE futures prices are licensed. Pyth and Chainlink redistribute them under their own agreements. Scraping CME settlement prices for the missing contracts (lumber, cotton, orange juice) through Switchboard may breach terms **[U]**. Use a licensed vendor.

**Technical and economic risks:**
- Latency arbitrage against the reserve.
- Futures-roll jumps.
- Weekend gaps.
- The **short-delta reserve**: commodity rallies make the reserve insolvent unless hedged.
- Oracle outages or manipulation, especially on thin novelty sources where one eBay sale moves the price.
- Keeper key compromise, which bounded moves and a multisig mitigate.
- Jupiter integration rejection, and aggregator concentration (Jupiter ≈80% of aggregator fees per LimeChain).
- A depeg spiral if the reserve runs dry while memecoin pools are full of COIN.

---

## 6. Recommendations

### (a) Oracle stack
1. **Primary: Pyth Core.** Use the 24/7 indices wherever they exist (gold, silver, oil, Brent, natural gas, copper), spot or LME feeds for other metals, and dated futures with keeper-blended rolls for the rest. Push into your own fixed-address update accounts so Jupiter can quote them.
2. **Secondary and weekend sanity check:** Stork 24/7 (majors) or Chainlink Data Streams v11 using `marketStatus`. Add them as a Composite deviation guard in phase 2.
3. **Custom:** Switchboard on-demand jobs (multi-source median, secret keys in variables) for the missing futures (licensed vendor), CS2 skins, OSRS gold and cards. Use a bounded `KeeperSigned` feed for food items.

### (b) Peg mechanism
Build the **Peg Desk**: an Anchor program that mints on buy and burns on sell at oracle ± dynamic spread, with:
- in-transaction freshness, monotonic-timestamp and confidence checks;
- session-aware halts or spreads;
- per-slot, per-transaction and supply caps;
- reserve-ratio circuit breakers;
- a hedge vault (PAXG/XAUt0 for gold, SLVon for silver, perps for oil).

Then pursue Jupiter AMM integration. Launch memecoins on Meteora DBC or Raydium LaunchLab with plain-SPL COIN as the quote.

### (c) Coverage (about 48 live or intraday, about 46 custom/slow)

**Tier A: 22 coins on Pyth native feeds.**
- Gold, silver, platinum, palladium, copper, aluminium, nickel, lead, 1-oz gold (metals).
- WTI, Brent, oil (PYTHOIL), natural gas, TTF gas (in EUR), gasoil (energy).
- Wheat, corn, soybeans, sugar, coffee, cocoa, live cattle (ags).

**Tier A-alt: 6 tokenized reference assets, also on Pyth.** PAXG, XAUT, XAUm, GLDx, GLD, USO. Usable as reserves or alternative quotes. (PAXG's Pyth feed ID was not retrieved in this pass **[U]**; the other five are listed in §1.1.)

**Tier B: about 26 custom coins with intraday data.**
- About 12 futures not on Pyth, sourced from a licensed vendor through Switchboard: RBOB gasoline, heating oil, soybean meal, soybean oil, rough rice, oats, cotton, orange juice, feeder cattle, lean hogs, Class III milk, lumber.
- About 14 CS2 skins and cases, plus OSRS gold, from marketplace APIs with 1–5 minute refresh.

The totals are Tier A + Tier A-alt + Tier B = 22 + 6 + 26 = 54 live or intraday. Counting only the original's coins (dropping the six reference tokens and the five Pyth extras it doesn't list: nickel, lead, 1-oz gold, TTF gas, gasoil), the live or intraday count is about 43.

**Tier C: about 35 slow custom coins.**
- 14 fast-food items (Big Mac twice a year from The Economist; others weekly or manual).
- 11 Pokémon cards plus ETB variants (daily, from TCG APIs, graded definitions).
- Misc items such as "Lambo" and "H2O" with manual updates.

**Excluded: 11 drug coins.**

### (d) Top five risks, in order
1. CFTC swap characterization and weak geo-blocking.
2. Short-delta reserve insolvency on commodity rallies.
3. Oracle latency arbitrage, rolls and weekend gaps (the Peg Desk design above addresses these).
4. Drug, trademark and IP content risk.
5. Dependence on Jupiter routing.

---

## Sources

**Pyth**
- https://hermes.pyth.network/v2/price_feeds?asset_type=commodities
- https://hermes.pyth.network/v2/price_feeds?asset_type=metal
- https://hermes.pyth.network/v2/price_feeds?query=XAU
- https://hermes.pyth.network/v2/price_feeds?query=GLD
- https://hermes.pyth.network/v2/price_feeds?query=USO
- https://hermes.pyth.network/v2/price_feeds?query=OIL
- https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana
- https://docs.pyth.network/price-feeds/core/push-feeds/solana
- https://docs.pyth.network/price-feeds/core/market-hours
- https://docs.pyth.network/price-feeds/core/best-practices
- https://docs.pyth.network/price-feeds/pro/price-feed-ids
- https://docs.pyth.network/price-feeds/pro/getting-started
- https://www.businesswire.com/news/home/20260317697899/en/Pyth-Network-Announces-Launch-of-First-Continuously-Updating-Oil-Price-Index
- https://www.businesswire.com/news/home/20260610193791/en/Pyth-Network-Launches-Proprietary-247-Index-Products-Across-Metals-Oil-and-U.S.-Equities-Partners-With-Marketvector-on-Equity-Index-Futures
- https://www.businesswire.com/news/home/20260422753096/en/Pyth-Network-Selected-as-Resolution-Source-for-Kalshis-Expanded-Commodities-Markets
- https://solanacompass.com/news/pyth-network-brings-crude-oil-pricing-on-chain-with-247-wti-and-brent-indices
- https://solanacompass.com/news/pyth-network-adds-gold-and-silver-indices-giving-defi-247-pricing-for-safe-haven-assets

**Switchboard**
- https://docs.switchboard.xyz/docs-by-chain/solana-svm/price-feeds/basic-price-feed
- https://docs.switchboard.xyz/llms-full.txt
- https://github.com/switchboard-xyz/sb-on-demand-examples

**Chainlink**
- https://docs.chain.link/data-streams/tutorials/solana-onchain-report-verification
- https://docs.chain.link/data-streams/tutorials/solana-offchain-report-verification
- https://docs.chain.link/data-streams/reference/report-schema-v11
- https://docs.chain.link/data-streams/reference/report-schema-v8
- https://docs.chain.link/data-streams/market-hours
- https://solanacompass.com/news/gmtrade-opens-gold-silver-and-wti-crude-oil-perpetuals-on-solana-with-247-trading
- https://gmxio.substack.com/p/gmx-solana-adopts-chainlink-data
- https://www.ccn.com/news/crypto/chainlink-on-chain-trading-gold-silver-crypto/

**Stork, RedStone, Edge**
- https://docs.stork.network/
- https://github.com/Stork-Oracle/Documentation/blob/main/api-reference/contract-apis/solana.md
- https://www.businesswire.com/news/home/20260513610201/en/Stork-to-Deliver-Institutional-Grade-Price-Oracles-From-RWA-Perps-Markets-247
- https://www.theblock.co/post/401053/stork-24-7-price-discovery
- https://app.redstone.finance/push-feeds/SOL/solanaMultiFeed
- https://chaoslabs.xyz/edge
- https://chaoslabs.xyz/posts/introducing-edge-the-next-generation-oracle

**Novelty data**
- https://cs2.sh/resources/best-cs2-skin-price-apis
- https://pricempire.com/api
- https://github.com/SKINSTRACK/CS2-Price-API
- https://www.scrapingbee.com/blog/pokemon-card-api/
- https://tcgdex.dev/markets-prices
- https://tcgapi.dev/
- https://github.com/TheEconomist/big-mac-data/blob/master/README.md

**DEXs, Jupiter, prop AMMs, launchpads**
- https://docs.meteora.ag/core-products/dlmm/what-is-dlmm
- https://docs.meteora.ag/developer-guide/guides/dbc/bonding-curve-configs
- https://github.com/MeteoraAg/dynamic-bonding-curve
- https://developers.jup.ag/docs/swap/routing/amm/integration
- https://github.com/jup-ag/jupiter-amm-interface
- https://www.figment.io/insights/the-rise-of-proprietary-market-makers-on-solana/
- https://limechain.tech/blog/making-sense-of-prop-amms-on-solana
- https://solanacompass.com/learn/Lightspeed/how-humidifi-became-solanas-largest-prop-amm
- https://docs.raydium.io/products/launchlab/overview
- https://crypto.news/raydium-launchlab-adds-support-for-any-token-pair-on-solana/
- https://latticepad.com/
- https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter-413621
- https://airdropalert.com/blogs/what-is-stonkfun/
- https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/
- https://commodites.market

**Tokenized assets**
- https://solana.com/news/case-study-xstocks
- https://xstocks.com/us/products
- https://www.kraken.com/xstocks/gldx
- https://www.kraken.com/xstocks
- https://metamask.io/news/metamask-adds-tokenized-us-stocks-etfs-and-commodities-via-ondo-global
- https://www.coindesk.com/business/2026/01/21/ondo-finance-brings-200-tokenized-u-s-stocks-and-etfs-to-solana
- https://solana.com/news/ondo-global-markets-tokenized-stocks-etfs-solana
- https://app.rwa.xyz/assets/SLVon
- https://solanacompass.com/projects/remora-markets
- https://www.coingecko.com/en/categories/remora-markets-tokenized-rstocks
- https://solanafloor.com/news/pre-stocks-success-on-solana
- https://www.coindesk.com/business/2026/04/21/bitget-exchange-brings-pre-ipo-tokens-to-masses-starting-with-spacex-on-solana
- https://www.paxos.com/blog/bringing-paxg-to-solana
- https://solanacompass.com/news/paxos-brings-pax-gold-to-solana-via-sunrise-making-paxg-the-first-occ-regulated-gold-token-on-the-network
- https://sunrise.xyz/press/2026-06-25-paxg-launch
- https://www.theblock.co/post/374786/tether-linked-usdt0-and-xaut0-launch-on-solana-via-layerzero-tech
- https://cointelegraph.com/news/solana-usdt0-xaut0-legacy-mesh-omnichain-launch
- https://solana.com/news/matrixdock-xaum-launch
- https://www.prnewswire.com/apac/news-releases/matrixdock-expands-xaum-to-solana-enabling-institutional-grade-tokenized-gold-at-scale-302680931.html
- https://solana.com/news/tokenizing-gold-inside-oro-s-vertically-integrated-bet
- https://solanacompass.com/news/solanas-tokenized-gold-market-cap-grew-689-in-a-year-outpacing-every-other-chain

**Regulatory**
- https://www.cftc.gov/PressRoom/PressReleases/8774-23
- https://www.morganlewis.com/pubs/2023/09/cftcs-message-to-defi-platforms-register-with-the-cftc-or-leave-the-us-market-or-risk-enforcement
- https://www.dlapiper.com/en-us/insights/publications/2024/01/sec-secures-victory-against-terraform-labs-and-founder-do-kwon-key-takeaways
- https://www.akingump.com/en/insights/alerts/are-crypto-tokens-securities-terraform-court-says-yes-in-extensive-decision
- https://www.dechert.com/knowledge/onpoint/2026/6/cftc-takes-historic-steps-to-bring-digital-asset-perpetual-contr.html
- https://grafa.com/en/news/crypto/cftc-chair-questions-perpetuals-for-commodities
- https://www.coindesk.com/policy/2026/05/28/u-s-cftc-opens-crypto-perp-door-with-approval-of-first-regulated-firm
- https://katten.com/perpetual-futures-come-onshore-the-cftcs-new-regulatory-framework
