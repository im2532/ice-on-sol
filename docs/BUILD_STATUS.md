# Build status — 11 Sep 2026 (v0.1, first pass)

## Verified offline
| What | How | Result |
|---|---|---|
| `peg_desk/src/pricing.rs` | `rustc --test` standalone | 21/21 pass |
| Rust ↔ TS pricing parity | 20,000 random vectors from pricing.rs replayed through `packages/sdk/src/pricing.ts` | 0 mismatches |
| SDK unit tests | pricing 24, merkle 8, twab | pass (mocha/chai shim) |
| Keccak / Merkle | standard vectors; SDK tree == tests/merkle.ts tree for 1–39 leaves | pass |
| Registry | `tsx packages/registry/src/validate.ts` + on-chain symbol/param rules | 83 commodities + 2 index coins OK |
| Anchor discriminators | `tsx scripts/print-discriminators.ts --check` | all OK |
| Program id placeholders | base58 → 32 bytes | OK (PegDesk id fixed to 43 chars) |
| rustfmt | `cargo fmt --check` | clean |
| TypeScript | `tsc` over sdk/registry/keeper/scripts/indexer/web lib | only missing-package errors |

## NOT verified (needs network / toolchain)
- `anchor build` for all four programs — first real compile will surface Anchor 0.31 API drift. Expect a few hours of fixes.
- `anchor test` — validator clones Meteora DBC, DAMM v2, Pyth receiver, Metaplex from mainnet.
- `pnpm install` + `next build` + `tsc` with real third-party types.
- Every `// VERIFY` / `// CHECK` comment (grep for them): Meteora account orders, byte offsets (`fee_router/src/constants.rs`),
  DBC SDK field names (`packages/sdk/src/dbc.ts`), Pyth receiver method names (`apps/keeper/src/cycles/oracle.ts`), Jupiter API shape.

## First-compile checklist (in order)
1. `make bootstrap` → `anchor build`. Fix compile errors program by program: peg_desk → fee_router → distributor → buyback.
2. `cargo tree -i anchor-lang` — ensure `pyth-solana-receiver-sdk` resolves to one anchor-lang version.
3. `anchor keys sync` → `make idl`.
4. Download IDLs: `curl https://raw.githubusercontent.com/MeteoraAg/dynamic-bonding-curve/main/idls/dynamic_bonding_curve.json` and DAMM v2 `cp_amm.json`; run `tsx scripts/print-discriminators.ts <dbc.json> <cp_amm.json>` to diff account orders; fix `cpi_ext/*.rs` and `fee_router/src/constants.rs` offsets.
5. `pnpm install`; fix `dbc.ts` against the installed `@meteora-ag/dynamic-bonding-curve-sdk` types; `pnpm typecheck`.
6. `anchor test` (peg_desk + distributor suites).
7. Devnet: deploy, seed GLD/SLV/HG with Pyth 24/7 feeds, run keeper oracle cycle, launch a test market from the UI.

## Open design questions (from review)
1. Switchboard-sourced coins have no keeper relay yet (MVP uses KeeperSigned for skins/cards via `sources/*`).
2. Payout min-holding filter needs a memecoin USD price (indexer candles) — disabled until then.
3. Keeper should resume unfinished epochs instead of opening new ones after a failure.
4. Buyback `min_ice_out` must be quoted (sandwich risk) before mainnet.
5. Indexer ingestion of DBC swaps / balance events is still TODO — payouts depend on `balance_events`.
6. `.env.example` USDC mint must match cluster.
7. One-tx launch may exceed legacy tx size → use v0 + lookup table (or the v1 4 KB format when live).

## Backlog (v1.1+)
- Index coins (PMX, CS2X) tradable in UI; Composite oracle path tested.
- Watches category (Rolex/AP via Chrono24 + Collector Crypt marketplace); Collector Crypt sales as TCG oracle cross-check.
- Jupiter AMM integration for the Peg Desk; seeded COIN/USDC DAMM v2 pools + keeper arb.
- Tokenize-anything (TCGplayer catalogue).
- Telegram/X bot via Solana Agent Kit (launch/quote by chat).
- Hedge vault rebalancing (PAXG/XAUt0 for GLD).
