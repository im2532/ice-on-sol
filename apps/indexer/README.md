# @icemarkets/indexer

Read API + on-chain ingest for ICEmarkets. Two processes, one database:

- `src/server.ts` — REST API on `:4000` (`PORT` env), read by `apps/web/lib/api.ts`. Endpoints:
  `GET /markets`, `GET /markets/:mint`, `GET /commodities`, `GET /commodities/:symbol`,
  `GET /commodities/:symbol/price-history`, `GET /trades/:mint`, `GET /candles/:mint`,
  `GET /rewards/leaderboard`, `GET /rewards/:wallet`, `GET /stats`.
- `src/webhook.ts` — Helius webhook receiver on `:4001` (`WEBHOOK_PORT` env), endpoint `POST /helius`.
  Accepts both Helius delivery types ("enhanced" and "raw"). Decoding lives in `src/decode/*`:
  - `anchorEvents.ts` + `events.ts` — ICEmarkets Anchor events from `Program data:` log lines, decoded with
    the IDLs read at runtime from `target/idl/*.json` (`IDL_DIR` override): peg_desk `Trade`,
    `PriceUpdated`, `StatusChanged`, `CommodityCreated`; fee_router `PoolRegistered` (→ `pools` upsert, with
    ticker/name/uri from the Metaplex metadata account), `FeesClaimed`, `FeesSplit`, `MigrationRecorded`;
    distributor `EpochOpened`, `Payout` (claims flip `merkle_leaves.claimed`), `EpochFinalized`; buyback `Buyback`.
    Enhanced payloads carry no logs, so for txs that invoked an ICEmarkets program the webhook fetches
    them with `getTransaction` (`RPC_URL`). A "raw" webhook avoids that extra call.
  - `swaps.ts` — Meteora DBC and (post-migration) DAMM v2 swaps of registered pools, from the net
    token-balance change of the pool's vaults (`pools.base_vault/quote_vault/damm_*_vault`) → `trades`;
    every wallet whose memecoin balance changed → `balance_events` (+ `balances`), the TWAB input.
  - `ingest.ts` — one tx → Postgres, idempotent (unique keys + `on conflict`), one SAVEPOINT per tx
    (a tx that fails to decode is stored in `raw_events.error` instead of failing the batch).
- `src/backfill.ts` — `pnpm --filter @icemarkets/indexer backfill -- <dbc_pool> [--limit N] [--resume]`:
  `getSignaturesForAddress` over the pool, its DAMM pool, the memecoin mint, the fee_router PoolState /
  holder_vault and the pool's Epoch PDAs, then `getParsedTransactions` → the same decoders.
- `src/candles.ts` — one-shot OHLCV rollup from `trades` → `candles` (1m/5m/1h/1d). Run on a schedule
  (cron, or as an `apps/keeper` job) with `pnpm --filter @icemarkets/indexer candles`.

## Setup

```bash
createdb icemarkets
psql icemarkets < schema.sql
cp ../../.env.example .env   # fill in DATABASE_URL at minimum
pnpm --filter @icemarkets/indexer dev       # REST API
pnpm --filter @icemarkets/indexer webhook   # webhook receiver, separate process
pnpm --filter @icemarkets/indexer backfill -- <dbc_pool>   # replay one pool's history
# production: pnpm --filter @icemarkets/indexer build && pnpm --filter @icemarkets/indexer start
#   (start runs node with --conditions=icemarkets-dist so @icemarkets/registry resolves to its dist/)
```

## What's stubbed vs. real

- `schema.sql` is the full table set from `docs/CONTRACTS.md` §5, ready for production data.
- `server.ts` queries real tables, but a handful of derived fields (24h price change, curve-fill %,
  per-market holder earnings, markets-per-commodity count) are commented as depending on a rollup job
  that isn't built yet — they fall back to `0` until that job (or a materialized view) exists. Everything
  else (trades, candles, leaderboard fee totals, rewards-by-wallet, global stats) reads real aggregates.
- `webhook.ts` also keeps every delivered payload in `raw_events` (JSONB) for replay/debugging.
- `balance_events` are written HERE (webhook/backfill); `apps/keeper`'s payouts cycle reads them for TWAB.

## Helius setup

One webhook (enhanced or raw) pointed at `POST /helius`, watching: the four ICEmarkets program ids, the DBC
and DAMM v2 program ids, and **every registered memecoin mint** (add each `pools.base_mint` as it is
registered) — otherwise wallet-to-wallet memecoin transfers that touch no watched program never reach
`balance_events` and TWAB undercounts. CHECK: confirm Helius matches plain SPL `transfer`s (which do not
list the mint) for a mint address; if not, watch the pool vaults + holders via `backfill.ts` on a schedule.

## Env

See `.env.example` at the repo root: `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_WEBHOOK_AUTH_HEADER`
(optional shared secret), `PORT`, `WEBHOOK_PORT`.
