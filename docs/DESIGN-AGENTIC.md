# Agentic UI — local redesign

All application routes use the Agentic design system from https://github.com/piyushxpj/agentic-ui. The approved Markets design is extended to Commodities, Launch, Rewards, Documentation, commodity details, market details, and fallback screens. All work is local.

## Source and structure

- `apps/web/components/agentic/`: complete vendored component library, original license, fonts, motion utilities, and scoped design tokens.
- `apps/web/public/agentic/assets/`: source icons and assets.
- `apps/web/components/markets/MarketsDashboard.tsx`: Markets screen, composed from the library.
- `apps/web/components/markets/MarketsDashboard.module.css`: screen composition and responsive layout.
- `apps/web/components/SiteChrome.tsx`: shared themed shell; Providers continue owning wallet and query state.

## Visual foundation

New York Large headings, Geist body text, Departure Mono labels, and JetBrains Mono code font are loaded through Next fonts. Agentic color, spacing, radius, shadow, and motion tokens are scoped under `.agentic-theme`. Navigation, Button, Input, Select, TabGroup, Icon and ProgressBar come directly from the source. The semantic HTML table adapts the source table showcase, which is not exported as a reusable component.

## Behavior

The original data API, mock mode, wallet provider, fee split, and destinations are retained. Market tabs, search, sort and eight-row pagination use the existing fetchMarkets query. Commodity cards link to existing detail screens. Rewards and overview use existing API fetchers. The mobile sidebar toggles from the header, and the table scrolls within its own container.

## Verification

Frontend TypeScript check passed. Desktop (1440px) and mobile (390px) document widths match their viewports; table overflow is contained on mobile. Browser DOM confirms the Agentic fonts and no broken images. The browser reported no runtime errors after a clean restart. The existing eligibility/terms modal remains in place and requires the user's own acceptance before end-to-end browser interaction checks.

Run locally at http://localhost:3001 with the workspace's `start-design-preview.command`.

## Extended pages

`components/layout/AppShell.tsx` owns navigation, wallet controls and footer. `PageHeader.tsx`, `SegmentedControl.tsx`, and `pages.css` provide shared page composition. Commodity browsing includes category filters and search. Launch uses Agentic fields, inputs, buttons and a live preview. Rewards retains claims and leaderboard behavior. Detail pages share chart controls, trading controls and activity tabs. Documentation uses a responsive section navigation. Charts read the theme colors and fonts.

The extended implementation passes frontend TypeScript checks. Full transaction and form interaction checks remain unverified while the original eligibility dialog awaits user action; no acceptance was performed by the agent.
