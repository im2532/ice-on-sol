## Solana Commodities-Launchpad GTM Research (Sept 2026)

### 1. Solana Brand Assets — CONFIRMED (core) / PARTIAL (typography)

| Element | Value | Status |
|---|---|---|
| Purple | `#9945FF` | **Confirmed** — solana.com/branding |
| Green | `#14F195` | **Confirmed** — solana.com/branding |
| Gradient | Purple→Green linear gradient (exact stop angle not published) | Confirmed direction, exact CSS not published |
| Dark background | Not specified on branding page; sites commonly use near-black (`#000000`/`#0D0D0D` range) | **Uncertain** — not officially documented |
| Wordmark | "Custom-built, modular type," angular/uniform, 1980s-tech-inspired — **not** a licensed font per official page | Confirmed (official page explicitly does not name a typeface) |
| "Diatype" claim | Third-party sites (Loftlyy, Typewolf) associate Solana's look with **ABC Diatype** (Klim-adjacent grotesk), but solana.com/branding itself names no font | **Uncertain/unconfirmed** — treat as a commonly-used lookalike, not an official spec |
| Logo rules | Don't: add shadows, add outlines, stretch, use low-res, frame imagery with it, place on low-contrast backgrounds. Maintain minimum clearspace. Assets: horizontal logotype, logomark, wordmark, vertical lockup, Foundation logotype (Google Drive) | Confirmed |

Source: [solana.com/branding](https://solana.com/branding)

**Recommendation:** Use `#9945FF`/`#14F195` gradient for the fork's accent system (differentiate enough to avoid trademark confusion — e.g., shift hue slightly or use as a secondary accent, not the primary brand identity, since Solana Foundation actively polices logo/gradient misuse in commercial contexts).

### 2. X Account Location / Blue Check — PARTIAL

- **x.com pages are blocked by robots.txt for automated fetch** in this environment, so I could not directly read the "location" field on @SolanaFndn, @Raydium, @MeteoraAG, or @JupiterExchange profiles. This needs a manual check (open the profile, click "Joined"/location on X) — I could not confirm it via search snippets either. **Uncertain — recommend the user check these four profiles directly** and copy whatever string appears (commonly projects use generic strings like "Solana," "Internet," or a real city — there's no evidence any of them spoof a specific real HQ location).
- Relevant existing account: **@launchonCME** ("Commodity Market Exchange") is the X handle already used by commodities.market's own token/brand — worth reviewing directly for tone/positioning since it's the platform being forked. [x.com/launchonCME](https://x.com/launchoncme)
- Note: **Solana's own X account (@solana) publicly endorsed StonkFun** — "We stand behind Stonk Tokens" — during its Sept 6, 2026 Raydium LaunchLab pump, showing Solana Foundation/Labs does amplify commodity/stock-paired launchpads organically when they gain traction. That's a more valuable GTM lever than copying a location field.

**X Premium / blue check pricing (2026) — CONFIRMED (US baseline, varies by country):**
| Tier | Monthly | Annual | Gets you |
|---|---|---|---|
| Basic | ~$3/mo | ~$32/yr | No blue check |
| Premium (blue check) | ~$8/mo | ~$84/yr | Blue checkmark, edit posts, algorithmic boost |
| Premium+ | ~$40/mo | ~$395/yr | Blue check + fewer ads + Grok access |
| Premium Business (gold check) | Org-tier, custom pricing | — | Gold checkmark, VIP support, impersonation defense |
| Verified Organizations (grey/gold) | Custom (reported $1,000+/yr baseline plus per-affiliate fees in past guidance) | — | Lets an org "affiliate" sub-accounts (employees, brand handles) with a blue check under the org's umbrella |
Requirements for any check: confirmed phone number, account active in last 30 days, no display name/photo/handle change in prior 3 days, subject to review.
Source: [help.x.com/en/using-x/x-premium](https://help.x.com/en/using-x/x-premium)

**Recommendation:** Cheapest path to a blue check for the project account is a straight **Premium subscription (~$8/mo)** on the account itself. Verified Organizations is worth it only if you want multiple team-member accounts to carry an affiliated badge.

### 3. Mascot Research — CONFIRMED brand facts, concepts below

**Real exchange brand facts:**
- **ICE (Intercontinental Exchange)** — corporate wordmark/monogram logo, deep blue, no character mascot. Actively trademarked brand (NYSE-listed parent of NYSE itself). [logos-world.net/intercontinental-exchange-ice-logo](https://logos-world.net/intercontinental-exchange-ice-logo/), [brandfetch.com/ice.com](https://brandfetch.com/ice.com)
- **LME (London Metal Exchange)** — since 2024 owned/operated in partnership with ICE (LME data now distributed via ICE's developer portal); wordmark logo, red/dark color scheme, no mascot. [brandfetch.com/lme.com](https://brandfetch.com/lme.com), [ICE Developer Portal LME listing](https://developer.ice.com/fixed-income-data-services/catalog/london-metal-exchange-lme)
- **CME Group** — wordmark only, no mascot (the "CME" mascot in commodities.market is an *original meme character*, not CME Group's actual branding).

**Trademark risk:** ICE, LME, and CME are all live, actively used financial-exchange trademarks (ICE is publicly traded, ~$90B+ market cap parent company; owns LME and NYSE). Literal use of "ICE," "LME," or "CME" as a token/brand name carries real trademark-dilution/confusion risk, especially combined with an exchange-styled logo. commodities.market's "CME" as a memecoin pun is already a legal grey area (it survives mostly because it's obviously satirical and small-scale) — deliberately naming a *second* product after another live financial exchange increases exposure, particularly since ICE actively enforces its mark (it's litigious around exchange-branding infringement historically).

**What comparable Solana launchpads use for mascots (confirmed via search):**
- **pump.fun** — no single official mascot; individual tokens/community memes (e.g., a fan-made "OP.FM" token references it) circulate, but the platform brand itself doesn't push one official character.
- **bonk.fun** — leans on the **BONK** dog/Shiba mascot (its own IP, unrelated to the unrelated retro game character "Bonk" — namesake collision noted, not derived from it).
- **bags.fm / believe** — no widely documented single mascot found in this pass; branding is more abstract/UI-driven. **Uncertain**, worth a follow-up screenshot check of their sites.
- **StonkFun** and **Ember (embercurve.fun)** — neither surfaced an explicit mascot character in research; StonkFun's brand centers on the "STONK" token name/meme (the classic "stonks" up-only-arrow meme guy is the informal community visual, not a proprietary Stonk.fun character); Ember's site uses a dark, minimal, non-mascot-driven design ("Meteora bonding-curve launchpad… launch a coin paired with any stock, 150+ tokenized stocks, dark theme #17191C").

**5 original mascot/name concepts (pun-adjacent, not infringing):**

1. **"ICEmarkets" — an ice-cream-cone/popsicle character.** Sounds like ICE, reads as a frozen-treat mascot, not an exchange logo. Tagline: "Cool your commodities." Low trademark risk if the logo is clearly a cartoon cone, not a corporate ICE-style monogram.
2. **"LMO" (Liquid Metal Order) or "ALLOY"** — a friendly robot/golem made of molten metal, punning on LME's metals focus without spelling LME. "Alloy" as the character name sidesteps the acronym entirely while still reading as a metals/robot mascot.
3. **"CBOTZ" or "COTTON BOT"** — a robot mascot punning on CBOT (Chicago Board of Trade) but spelled distinctly ("Bot" wordplay), styled as a friendly trading-floor robot in overalls.
4. **"NYMEX" avoid entirely → "NIGHTMEX" or "MEX the Barrel"** — an oil-barrel character with a face, punning loosely on NYMEX (energy exchange) via "barrel" imagery rather than the acronym itself.
5. **"COMEX" avoid → "GOLDIE" the gold-bar mascot** — a smiling gold-ingot character referencing COMEX's metals/gold futures niche without using "COMEX" at all — pure commodity-object mascot (safest legal profile of the five, since it uses no exchange name/acronym).

**Safe-variant naming principle:** favor mascots built from the *commodity itself* (ice cream, gold bar, oil barrel, wheat stalk) or a near-homophone (ICEmarkets, Alloy, Goldie) over literal exchange acronyms (ICE, LME, CME, CBOT, NYMEX, COMEX) — this is what already lets commodities.market's "CME" pun exist relatively safely (it's a stretch/parody, not identical branding), but stacking a second literal acronym raises risk, especially against ICE, which is a real, large, litigious public company.

### 4. Stonk.fun / Ember (embercurve.fun) Case Studies — CONFIRMED (recent), gaps noted

**StonkFun (stock-paired Solana launchpad, native token STONK):**
- **Sept 6, 2026**: STONK surged **250% in 24h** to **~$140M market cap** (from ~$50M) after **Raydium LaunchLab integration** went live — "deeper liquidity, better fills, fairer launches." [x.com/Raydium/status/2096316117799309714](https://x.com/Raydium/status/2096316117799309714)
- Peak price **$0.212**, daily volume **~$135M** during the pump.
- STONK pairs against **SPYx** (tokenized S&P 500 exposure) and other "xStock"-style tokenized-equity quote assets — memecoins trade against stock-tracking tokens rather than SOL/USDC.
- Sympathy rally: **RAY +46%, JUP +~21%** same day — Raydium and Jupiter both saw token-price upside from the association (not confirmed whether either team tweeted independent endorsement beyond the LaunchLab product announcement itself).
- **Solana's own X account publicly endorsed it**: "We stand behind Stonk Tokens." This is a strong signal that Solana Foundation/Labs social accounts will amplify commodity/stock-themed launchpads that gain organic traction — a GTM target worth designing toward.
- Buyback program funded by trading fees.
- Follower counts, exact launch date, trailer video, and specific KOL spend were **not found / uncertain** in available sources — worth a manual X search on the StonkFun account directly.
- Sources: [The Block, Sept 6 2026](https://www.theblock.co/news/defi/2026-09-06-stonk-surges-250-to-140-million-market-cap-as-stock-paired-solana-launchpad-stonkfun-pulls-volume-to-raydium-and-jupiter-413621), [AirdropAlert](https://airdropalert.com/blogs/what-is-stonkfun/), [Bitquery StonkFun API docs](https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/)

**Ember (embercurve.fun):**
- Positioned as **"launch a coin on Solana, paired with any stock"** — built as a **Meteora bonding-curve launchpad** (i.e., built directly on Meteora's Dynamic Bonding Curve infra, similar to what a commodities fork would do).
- Supports **150+ tokenized stocks** as pairing assets.
- Fee model: **80% of fees** can be routed to holders, token burns, a "SuperLotto" mechanism, or the project team (creator-configurable).
- Dark UI theme (`#17191C`), no distinct mascot found.
- Launch date, follower counts, peak volume, and KOL/partnership specifics were **not found — uncertain**, likely requires checking @embercurve directly and Dexscreener trading history.
- Source: [embercurve.fun](https://embercurve.fun/)

**Raydium's stock/commodity-launchpad activity:** Raydium's **LaunchLab** product is the direct integration layer StonkFun (and presumably Ember-style forks) plug into for deeper liquidity/bonding-curve graduation — this is the concrete "what Raydium did around stocks on Solana" mechanism, not a one-off marketing partnership. Getting **LaunchLab integration** is the single highest-leverage Raydium move a new launchpad can pursue.

**Meteora's partner program:** Meteora publishes an open-source **"Fun Launch" scaffold** (Meteora Invent toolkit, Dynamic Bonding Curve, Next.js/TypeScript/Solana Web3.js stack) that lets any team **build their own pump.fun-style launchpad on Meteora's DBC infrastructure** — this is effectively the technical version of "Launch with Meteora." I could not confirm a distinct *marketing/co-promotion* program beyond the technical scaffold/liquidity infra itself — **uncertain**, recommend checking meteora.ag or Discord directly for any formal partner-marketing tier. [docs.meteora.ag/.../fun-launch](https://docs.meteora.ag/developer-guide/invent/scaffolds/fun-launch), [launch.meteora.ag](https://launch.meteora.ag/)

**Jupiter Studio:** Jupiter's own token-launch product (live since 2025). Charges **1% fee per buy/sell**; has **anti-sniper protection** (99%→0% decaying tax over first 15–60 seconds post-launch). Offers **Jupiter Verify** (v4 as of 2026) — a token-verification/trust-layer system checking mint/freeze authority, holder concentration, dev activity — described as "Solana's most trusted public good." Reported to have done **$100M volume on its first day**. A CryptoSlate review notes project support/creator tooling is "real" but incubation is "lighter than a true advisory... program" — i.e., no deep white-glove marketing partnership, mostly self-serve tooling + verification credibility. Sources: [CryptoSlate Jupiter Studio review](https://cryptoslate.com/launchpads/jupiter-studio-review/), [SolanaFloor: $100M day-one volume](https://solanafloor.com/news/launchpad-mania-jupiter-studio-enters-the-arena-with-100m-volume-on-first-day), [Jupiter Verify v4 announcement](https://x.com/JupiterExchange/status/1950653461898707173)

### 5. Trailer Video Tools & Cost — PARTIAL

- 2026 leading models for a 30-60s launch trailer: **Google Veo 3.1, Kling 3.0, OpenAI Sora 2, Runway** (Gen-4-class), plus traditional **After Effects freelancers** and **Remotion** (code-driven video, good for programmatic/data-driven brand trailers).
- Raw API/clip pricing is genuinely low: roughly **$0.10–$1.00+ per clip** depending on model/resolution/duration (GPU compute-driven) — but this is per short clip (often 5-10s), so a full 30-60s trailer requires **multiple generated clips stitched together** plus editing, meaning **all-in cost is more a function of editor/creative time than raw generation cost**. **Exact per-tool $/second breakdown for Veo 3.1 / Kling 3.0 / Sora 2 specifically was not confirmed** in this pass — worth a direct pricing-page check (Runway, Kling via Kuaishou, Google AI Studio Veo pricing, OpenAI Sora pricing) before budgeting.
- Practical 2026 crypto-project pattern: teams typically combine AI-generated clips (Kling/Veo/Sora for hero shots) with a freelance editor (Fiverr/Upwork-tier, often **$150–$800** for a polished 30-60s crypto trailer edit) rather than a full traditional VFX house — **this cost estimate is inferred from general market patterns, not confirmed via a specific 2026 source**, flag as uncertain.

### 6. Launch Playbook — CONFIRMED where noted

- **Raydium LaunchLab integration**: proven amplifier (StonkFun case above) — cheaper deployment, reduced sniper risk, compounding liquidity post-bonding.
- **Jupiter Verify (v4, 2026)**: apply for token verification to appear as trusted/safe-flagged across Jupiter's swap UI and aggregated venues — checks mint/freeze authority, holder concentration, dev activity. [discuss.jup.ag FAQ Token List V3](https://discuss.jup.ag/t/faq-token-list-v3-verification/23074)
- **Dexscreener Enhanced Token Info**: paid product, reported around **$299** (verify current price directly — described by third-party trackers as "currently $299," not an official Dexscreener-published figure) — buys the ability to add/update website, socials, description, and profile fields; does **not** fix broken metadata/image-hosting issues upstream. [marketplace.dexscreener.com/product/token-info](https://marketplace.dexscreener.com/product/token-info)
- **Birdeye**: has a "Token Info Update Service" for updating listing metadata — specific pricing/badge criteria not confirmed in this pass ([docs.birdeye.so/docs/token-info-update-service](https://docs.birdeye.so/docs/token-info-update-service)) — **uncertain**, check docs directly.
- **CoinGecko**: **no official listing fee** — platform confirms listing itself is free — but realistic all-in readiness costs (audit, KYC/KYB, exchange liquidity, website/whitepaper, ops) run an estimated **$25K–$110K+** per third-party consultancy figures (not CoinGecko's own published cost — this is an intermediary's estimate, treat as directional not official). Requires at least one CEX/DEX listing with public API + legitimate volume, audited/verified contract, transparent supply methodology. Timeline: **1-3 weeks prep + 2-6+ weeks review**. [CoinGecko listing terms](https://www.coingecko.com/en/listing_terms), [listing.help cost estimate](https://listing.help/coingecko-listing-cost/)
- **Community channel**: Solana memecoin culture (the "trenches") skews heavily **Telegram + X-native**, with Discord less central than in prior NFT-era cycles — **directionally confirmed** by general ecosystem coverage, though no single source gave a hard Telegram-vs-Discord stat in this pass.
- **KOL/"trenches" costs**: could not find confirmed 2026 pricing figures for Solana KOL shill calls in this research pass — **uncertain, needs direct outreach/quote-gathering** (historically this market has ranged informally from a few hundred to tens of thousands of dollars per call depending on KOL follower count/track record, but no 2026-specific number was confirmed here).

---

**Overall confidence note:** Solana brand hex codes, X Premium pricing, StonkFun's Sept 2026 Raydium pump, CME/ICE/LME real-world branding, Jupiter Verify, and CoinGecko's no-fee policy are all **confirmed** from primary or reasonably authoritative sources. The weakest areas — X profile "location" fields, exact AI-video per-tool pricing, Meteora's formal marketing-partner terms, Birdeye's specific badge process, and current KOL call rates — are **flagged uncertain** and need a manual/live-browser check or direct outreach rather than search-engine research, since X.com blocks automated fetching and several of these are opaque, quote-on-request markets.
