# Glacier — the ICEmarkets design system

The web app (`apps/web`) is built on **Glacier**: a dark ground with a faint aurora of Solana
purple and green, liquid-glass panels, and a monospaced treatment for every number on screen. The
canonical reference is the design canvas — `Main.dc.html` (home), `Listing.dc.html` (token page),
`Mint.dc.html` (launch), `Phone.dc.html` and `canvas.json`. Its **layout and styling** are the
contract; its invented vocabulary is not (see §3). This document is the implementation contract.

---

## 1. Tokens

Defined once in `app/globals.css` on `:root`, mirrored as Tailwind colours in `tailwind.config.ts`.

| Token | Value | Tailwind | Use |
| --- | --- | --- | --- |
| `--ground` | `#05060B` | `bg-ground` | Page ground. Nothing else is this dark. |
| `--text` | `#EEF0F6` | `text-text` | Primary text. |
| `--muted` | `#8B90A6` | `text-muted` | Labels, eyebrows, secondary numbers. |
| `--body` | `#B7BBCB` | `text-body` | Running prose. |
| `--dim` | `#C9CCDA` | `text-dim` | Chip text, tertiary links. |
| `--positive` | `#14F195` | `text-positive`, `bg-positive` | Up moves, yield, Buy, focus rings. |
| `--negative` | `#FF5C7A` | `text-negative` | Down moves, Sell, halts. |
| `--purple` | `#9945FF` | `text-purple` | Gradient start, `$ICE` burn. |
| `--lavender` | `#C9B6FF` | `text-lavender`, `.link` | Inline links, secondary emphasis. |

Support tokens: `--glass-bg` `rgba(255,255,255,.045)`, `--glass-border` `rgba(255,255,255,.10)`,
`--glass-bg-strong` `.07`, `--glass-border-strong` `.14`, `--hairline` `.08`, `--hairline-soft`
`.06`, `--well` `rgba(0,0,0,.30)`.

The gradient — `linear-gradient(135deg, #9945FF, #14F195)` — is the only gradient in the system.
It appears on the primary button, the mark, the curve bar, the mobile Launch button and the `$ICE`
icon. Never on text.

### Type

Loaded through `next/font/google` in `app/layout.tsx`:

- **Sora** 500/600/700 → `--font-display`, class `.display` / `font-display`. Headings and panel
  titles. `letter-spacing: -0.02em`.
- **Manrope** 400–700 → `--font-body`, the `body` default and `font-sans`.
- **JetBrains Mono** 400/500/600 → `--font-mono`, class `.mono` (alias `.font-nums`) and
  `font-mono`. **Every number, ticker, address and micro-label is mono with `tabular-nums`.**

Inter is gone.

### Spacing and radii

One measure for everything: `.container-x` — max-width **1280px**, `margin-inline: auto`,
padding-inline 16px rising to 24px at md. Nav, every page wrapper and the Footer use it, and
nothing in the app is wider. Panels use
20px radius (`.glass`), inputs 12–14px, chips fully round. Grid gaps are 12–16px inside panels,
20–28px between sections.

---

## 2. Component classes

All defined in `app/globals.css` under `@layer components`, so Tailwind utilities still win.

| Class | What it is |
| --- | --- |
| `.glass` | The standard panel: `rgba(255,255,255,.045)` bg, 1px `.10` border, `blur(24px) saturate(160%)`, inset top highlight `.14`, `0 24px 60px rgba(0,0,0,.45)`, radius 20px. |
| `.glass-strong` | Nav, trade panel, mint preview, toasts, modal: `.07` bg, `.14` border, `blur(28px) saturate(180%)`, deeper shadow. |
| `.chip` | 26px pill, `.06` bg, `.10` border, 12px/500 text in `--dim`. Variants `.chip-on` (selected), `.chip-positive`, `.chip-warn`. |
| `.eyebrow` | Mono 11px, `0.14em` tracking, uppercase, muted. Every panel label. |
| `.tab` / `.tab-on` / `.tabset` | 34px tab; the active one gets `.10` bg and an inset highlight. `.tabset` is the 3px-padded rail they sit in. |
| `.btn-primary` | 44px, radius 14, purple→green gradient, **dark** (`#05060B`) 700 text, purple glow shadow. |
| `.btn-ghost` | 44px, radius 14, `.06` bg with a `.12` border. |
| `.field` / `.well` | Dark input well: `rgba(0,0,0,.3)` on a `.08` hairline. `.field` is flex for a wrapper, block when applied to an `input`/`textarea` directly. |
| `.th` / `.td` | Table header (mono, uppercase, 11px) and cell (14px, hairline underline; last row loses it). |
| `.tile` | Heat-grid / small tile: radius 12, `.08` border, inset highlight. |
| `.step-badge` | 26px round mono badge for the Launch steps. |
| `.aurora-layer` + `.aurora-purple` / `.aurora-green` / `.gridlines` | The fixed background, painted once by `<Aurora />` in the root layout. |
| `.tap` | Enforces 44×44 minimum targets at ≤768px. |

### Fallbacks

- `@supports not (backdrop-filter)` → glass becomes an opaque `rgba(19,21,32,.94)` panel.
- `@media (prefers-reduced-transparency: reduce)` → blur off, opaque panels, aurora and gridlines
  hidden.
- `@media (prefers-reduced-motion: reduce)` → all animation and transition durations collapse.

Focus is a 2px `--positive` ring at 2px offset, on `:focus-visible` only.

---

## 3. Vocabulary

Glacier is a **visual** system only. The product keeps industry-standard terminology throughout —
a launchpad's users already know these words, so the UI does not invent new ones.

| Term | Where it shows |
| --- | --- |
| **Markets** (`/`) | Home. The table of every token. |
| **Commodities** (`/commodities`) | The commodity coins a market can be paired with. |
| **Launch** (`/launch`) | "Launch a market" — the creation flow. |
| **Rewards** (`/rewards`) | "Hold a market, get paid in commodities." |
| **Docs** (`/docs`) | How it works. |
| **commodity coin** | A synthetic coin pegged to a real commodity (GLD, HG, DAYTONA …). |
| **market** | One launched token and its pool. |
| **paired with** | The relationship between a market and its commodity coin ("Paired with GLD · Gold"). |
| **% of curve** / **Graduated** | Bonding-curve progress, then migration to DAMM v2. |
| **Connect wallet** | The wallet button. |
| **Holder rewards** | The live payout feed — "paid in the commodity coin, every 15 minutes, nothing to claim". |
| **Commodities · 24h** | The heat grid on the home page. |
| **Activity** → Trades / Holder payouts / Holders | The token page's tabbed panel. |
| **Your market, as it will appear** | The Launch preview card. |
| **Creator share: none** | Unchanged — there is no creator cut. |

There are **no redirects** in `next.config.ts`: these are the only paths the app has ever shipped.

Domain type names (`Market`, `CommodityQuote`, `commoditySymbol`, the `/commodities` and `/rewards`
API paths) match the UI vocabulary exactly, so the indexer contract and the copy stay in step.

An earlier draft of this redesign shipped an invented vocabulary (Floor / Anchors / Mint / Yield /
Learn, "anchor", "listing", "bonded %", "Tape"). It was reverted wholesale — if you find any of
those words in the tree, they are a leftover and should be replaced.

## 4. Component inventory

### Chrome
| File | Role |
| --- | --- |
| `components/Mark.tsx` | `Mark` (hexagonal ice-crystal SVG) and default `Logo` (mark + "ICE" white / "markets" muted). |
| `components/Aurora.tsx` | The fixed aurora + gridline layer. |
| `components/Nav.tsx` | Floating `.glass-strong` bar ≥md (Markets · Commodities · Launch · Rewards · Docs, wallet, X link); mark + wallet chip below. Exports `NAV_LINKS` and `isActive`. |
| `components/MobileNav.tsx` | Bottom glass bar ≤768px with the centre gradient Launch button. |
| `components/Footer.tsx` | One mono line (`$ICE <addr> · How it works · Explorer`) + one sentence of disclosure. |
| `components/ConnectButton.tsx` | "Connect wallet" ghost button / connected mono address chip. |
| `components/Toast.tsx`, `components/TosModal.tsx` | Glass-strong toasts and the eligibility gate. |
| `components/Mascot.tsx` | The old ice-cream character. **404 only.** |

### Home
| File | Role |
| --- | --- |
| `components/CommodityHeat.tsx` | "Commodities · 24h" heat grid — colour = 24h move, span = markets paired, with category chips. 6 cols desktop, 4 on phone. |
| `components/MarketsTable.tsx` | Trending / New pairs / Graduated tabs, search, six columns (Market · Commodity · Market cap · 24h · Curve · Holders 24h), "Show 50 more". Collapses to rows ≤md. |
| `components/RewardsFeed.tsx` | "Holder rewards" live payout feed + next-payout countdown. |
| `components/FeeDonut.tsx` | The 40/20/20/20 "Where a fee goes" SVG donut. |
| `components/IceCard.tsx` | The `$ICE` strip. |

### Shared
| File | Role |
| --- | --- |
| `components/CommodityLogo.tsx` | `<CommodityLogo symbol size className rounded?>` — one commodity's animated SVG mark, with a `swatch()` initials fallback. See §7. |
| `components/Bonding.tsx` | Gradient curve bar + "72%" / "Graduated". |
| `components/CommodityTile.tsx` | One commodity coin on `/commodities`. |
| `components/MarketCard.tsx` | One market as a glass card. |
| `components/StatusPill.tsx` | Open / Closed / Halted as a chip. |
| `components/Chart.tsx` | lightweight-charts **area** series: line `#14F195`, area fading to transparent. Candles collapse to close. |
| `components/TradesTable.tsx` | The token page's Activity panel: Trades / Holder payouts / Holders. |
| `components/TradePanel.tsx` | Glass-strong trade panel: Buy/Sell segmented, pay-with chips, big mono amounts, route line, commodity price + age, fee → holders, slippage, gradient CTA. All Closed/Halted logic from `lib/session.ts` preserved. |
| `components/Leaderboard.tsx` | Rewards leaderboard, styled like the Markets table. |

### Launch wizard
`components/wizard/CommodityPicker.tsx` (step 1 "Paired with", green ring on the selection),
`components/wizard/IdentityFields.tsx` (step 2, dropzone + fields; exports `IdentityState`,
`EMPTY_IDENTITY`), `components/wizard/FeeAndBuy.tsx` (step 3; exports `FeeState`, `DEFAULT_FEE`),
`components/wizard/PreviewCard.tsx` (the sticky "Your market, as it will appear"). Launch is one
flowing form, not an accordion.

### Deleted
`FeeSplitBar.tsx` (replaced by `FeeDonut`), `CurveProgress.tsx` (replaced by `Bonding`),
`StatTile.tsx` (replaced by inline glass stat strips), `CommodityCard.tsx` (replaced by
`CommodityTile`).

## 5. Data and formatting

Data flow is untouched: `lib/api.ts`, `lib/actions.ts`, `lib/mock.ts`, `lib/session.ts`,
`lib/cluster.ts`, the wallet providers and every SDK call work exactly as before. Two additive
changes only:

- `Payout` in `lib/types.ts`, `mockRecentPayouts()` in `lib/mock.ts` and `fetchRecentPayouts()` in
  `lib/api.ts` (`GET /rewards/payouts`) — the home page's Holder rewards feed.
- `lib/visual.ts`, a new pure module: `swatch()` / `swatchColor()` (deterministic per-symbol icon
  gradients), `heatBackground()` (green/red tint scaled to |24h| up to 3%), `curveLabel()` and
  `signed()` (true minus sign `−`).

Rules that hold everywhere:

- Every number formats through `lib/format.ts`, always with the `en-US` locale. Four helpers, and
  nothing hand-rolled: **`fmtPrice` / `fmtPriceUsd`** for prices (<1 → 4dp, <10 → 3dp, else 2dp
  grouped; whole numbers stay whole; below 0.0001 falls back to 3 significant digits),
  **`fmtAmount`** for coin quantities (≥4 significant figures, ≤6 decimals, trailing zeros
  trimmed — so a small payout never reads "0.00"), **`pct`** for rates, and **`compact`** for
  market caps and volumes *only*. The only surviving `.toFixed` in components is SVG dash geometry
  in `FeeDonut`.
- Every numeric column is right-aligned, mono, `tabular-nums`, and `white-space: nowrap`.
- `truncate` is reserved for user-generated names (a market's name or ticker) and long product
  display names. Eyebrow labels, numbers and registry symbols wrap or are sized to fit — they are
  never ellipsized.
- Percentages render through `signed()` so gains read `+18.4%` and losses `−4.2%`.

## 7. Commodity marks

Every commodity coin — the 96 in `packages/registry/src/commodities.ts` (`COMMODITIES` +
`INDEX_COINS`, exported together as `ALL`) — has a hand-drawn, lightly animated SVG mark at
`apps/web/public/commodities/<SYMBOL>.svg`. `_TEMPLATE.svg` and `_PALETTE.md` live in the same
folder as authoring references and must **never** be served as a coin's logo (they aren't named
after a registry symbol, so `CommodityLogo` never resolves to them by construction).

### Family rules

- **One mark per registry `symbol`**, filename exactly `<SYMBOL>.svg` (the on-chain symbol, same
  casing as `commodities.ts`).
- Same viewBox and construction as `_TEMPLATE.svg`; palette drawn from `_PALETTE.md` so marks read
  as one family at a glance in `/commodities` and the heat grid.
- Subtle SVG-native animation only (a slow gradient drift, a soft pulse) — nothing that competes
  with the mono numbers around it, and everything collapses under
  `prefers-reduced-motion: reduce` per the usual Glacier rule (§2).
- Served statically from `/public`, so no build step touches them; `next.config.ts` sends
  `Cache-Control: public, max-age=31536000, immutable` for `/commodities/:path*`.

### Rendering: `CommodityLogo`

`components/CommodityLogo.tsx` — `<CommodityLogo symbol size={32} className rounded? />`.
Renders `<img src="/commodities/<SYMBOL>.svg">` lazily; `onError` swaps to the existing
`swatch()` gradient with the symbol's first two letters in 11px mono — the same fallback the
system already used everywhere before hand-drawn marks existed, so a coin mid-rollout never shows
a broken image. Wrapped in `React.memo`.

Sizes in use across the app:

| Size | Where |
| --- | --- |
| 14–16px | Inline chips — "Pay with", "Paired with", the Markets table's Commodity chip |
| 28–32px | Table rows, tiles' corner mark, rewards rows |
| 36–40px | `/launch` CommodityPicker rows, CommodityTile, the token page's "Paired with" card |
| 48–56px | Heat-grid big tiles, `/dev/logos` |
| 72px | `/commodities/[symbol]` page header |

A memecoin **market**'s own image keeps the generated market `swatch()` until it has a real
uploaded image — `CommodityLogo` is only ever used for a commodity coin, never a market.

### Adding a new coin's mark

1. Add the coin to `COMMODITIES` (or `INDEX_COINS`) in `packages/registry/src/commodities.ts`.
2. Duplicate `_TEMPLATE.svg` to `<SYMBOL>.svg` in `apps/web/public/commodities/`, and pick colors
   from `_PALETTE.md` (or extend it, for a new category).
3. Nothing else to wire up — every call site renders by `symbol`, so the new file is picked up
   everywhere the coin already appears. Check it at `/dev/logos` in development.

## 8. Accessibility

Focus-visible green rings everywhere; `.tap` guarantees 44px targets on phones; tabs carry
`role="tab"` + `aria-selected`, filters `aria-pressed`, the curve bar `role="progressbar"` with
`aria-valuenow`; every icon-only control has an `aria-label` and decorative SVGs are
`aria-hidden`; the halted/closed banner is `role="alert"`; the aurora is inert
(`pointer-events: none`) and disappears under reduced-transparency.
