# @icemarkets/keeper

Off-chain automation for ICEmarkets: oracle pushes, the trading-session calendar, fee claims,
holder payouts, DBC->DAMM v2 migrations, and the GLD->ICEmarkets buyback. See
`docs/CONTRACTS.md` for the on-chain instruction contracts this drives, and
`docs/research/03-oracles-and-peg.md` for the design rationale.

## Run

```bash
cp .env.example .env   # fill in RPC_URL, KEEPER_KEYPAIR_PATH, DATABASE_URL, program ids, API keys
pnpm install
pnpm --filter @icemarkets/keeper dev     # tsx watch, restarts on file change
# or
pnpm --filter @icemarkets/keeper start   # single run, no watch
```

Requires:
- A Postgres database matching `apps/indexer/schema.sql`'s tables (`prices`, `pools`,
  `balance_events`, `epochs`, `payouts`, `fee_claims`, `buybacks`, `merkle_leaves`,
  `commodities`) — the indexer owns the schema; the keeper only reads/writes rows.
- A funded keeper keypair present in every program's `GlobalConfig.keepers` /
  `RouterConfig.keepers` / `DistConfig.keepers` list.
- `GET /healthz` on `HEALTHZ_PORT` (default 8787) reports `{ healthy, lastRunAt, lastError }`
  per cycle for a process supervisor / uptime check.

## Cycle table

| Cycle | File | Interval (env) | What it does |
|---|---|---|---|
| `oracle` | `src/cycles/oracle.ts` | `ORACLE_PUSH_INTERVAL` (30s) | Batches Hermes updates (≤5 feed ids/tx) into per-commodity Pyth update accounts for `PythPull` commodities; posts `keeper_update_price` for `KeeperSigned` commodities from `src/sources/*`. Deviation-triggered (≥0.1%) in addition to the interval. |
| `session` | `src/cycles/session.ts` | `SESSION_CYCLE_INTERVAL` (15s) | Flips `Commodity.status` Open↔Closed by trading-hours calendar (CmeGlobex/IceUs/Lme); never auto-flips out of Halted. |
| `fees` | `src/cycles/fees.ts` | `FEE_CYCLE_INTERVAL` (900s) | `fee_router.claim_dbc` / `claim_damm` for pools with unclaimed fees ≥ ~$100. |
| `payouts` | `src/cycles/payouts.ts` | `FEE_CYCLE_INTERVAL` (900s) | TWAB from `balance_events` → `open_epoch` → `push_payouts` (chunks of 12, existing ATAs only) → Merkle root + `finalize_epoch` for the remainder; proofs stored in `merkle_leaves`. |
| `migrate` | `src/cycles/migrate.ts` | `MIGRATE_CYCLE_INTERVAL` (60s) | Polls DBC pools with a completed curve and not yet migrated → `migrateToDammV2` → `fee_router.record_migration`. |
| `buyback` | `src/cycles/buyback.ts` | `BUYBACK_CYCLE_INTERVAL` (900s) | `buyback.convert_and_burn` (GLD→ICEmarkets→burn, MVP scope) once `buyback_vault[GLD]` clears a small USD threshold. |

Each cycle runs on its own `setTimeout` loop with random jitter (0–1s) so cycles don't all
fire in lockstep; a cycle's failure is logged and retried on its next scheduled tick rather
than crashing the process (`main.ts`'s `scheduleCycle` wraps every run in try/catch).

## Data sources for KeeperSigned / Switchboard commodities

- `src/sources/manualPrices.ts` — reads `data/manual-prices.json` (fast food, water,
  cars). Fast-food figures are from the Economist Big Mac index / a menu-price check
  (`docs/research/01`); `H2O`/`LAMBO` are placeholder estimates flagged
  `TODO-verify` in their `source` field.
- `src/sources/cs2.ts` — median of Pricempire, CSFloat, Skinport.
- `src/sources/tcg.ts` — pokemontcg.io TCGplayer market price.
- `src/sources/osrs.ts` — **stub**, not implemented (see its file header for why:
  gray-market RMT data is low quality and may violate Jagex's ToS).
- `src/switchboard/jobs/*.json` — example Switchboard On-Demand job definitions
  (cs2 median, tcg market, licensed-vendor futures) for when these move off
  `KeeperSigned` onto real Switchboard feeds.

## Known gaps / CHECK markers

Every file that touches an SDK package this sandbox couldn't install (no network access —
`@meteora-ag/dynamic-bonding-curve-sdk`, `@meteora-ag/cp-amm-sdk`,
`@pythnetwork/hermes-client`, `@pythnetwork/pyth-solana-receiver`) carries a `// CHECK vs
SDK ...` comment at the point where an exact field/method name is uncertain.

All ICEmarkets program calls go through `src/programs.ts`, which reads `target/idl/<name>.json` at
runtime (override with `IDL_DIR`) and builds `Program<any>` with the program ids from `.env`.
The keeper refuses to start until `anchor build` has produced the four IDLs; no code edits are
needed afterwards. Account keys in `program.methods.<ix>().accountsPartial({...})` are the
camelCase of the Rust `#[derive(Accounts)]` field names. Meteora PDAs (pool authority, event
authority, token vaults, DAMM positions) come from `@icemarkets/sdk` `meteora.ts` — marked CHECK there.
