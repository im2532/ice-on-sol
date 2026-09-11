# @icemarkets/indexer

Read API + on-chain ingest for ICEmarkets. Two processes, one database:

- `src/server.ts` — REST API on `:4000` (`PORT` env), read by `apps/web/lib/api.ts`. Endpoints:
  `GET /markets`, `GET /markets/:mint`, `GET /commodities`, `GET /commodities/:symbol`,
  `GET /commodities/:symbol/price-history`, `GET /trades/:mint`, `GET /candles/:mint`,
  `GET /rewards/leaderboard`, `GET /rewards/:wallet`, `GET /stats`.
- `src/webhook.ts` — Helius Enhanced webhook receiver on `:4001` (`WEBHOOK_PORT` env), endpoint
  `POST /helius`. Configure a Helius webhook watching `peg_desk`, `fee_router`, `distributor`,
  `buyback` and the Meteora DBC program ids (see `packages/registry/src/programs.ts`), delivery
  type "enhanced". Writes a raw audit trail to `raw_events` today; per-program event decoding is
  marked `TODO` pending the Anchor IDLs (`anchor build` output) for typed borsh/Anchor decoding of the
  events listed in `docs/CONTRACTS.md` (`Trade`, `PriceUpdated`, `FeesSplit`, `Payout`, …).
- `src/candles.ts` — one-shot OHLCV rollup from `trades` → `candles` (1m/5m/1h/1d). Run on a schedule
  (cron, or as an `apps/keeper` job) with `pnpm --filter @icemarkets/indexer candles`.

## Setup

```bash
createdb icemarkets
psql icemarkets < schema.sql
cp ../../.env.example .env   # fill in DATABASE_URL at minimum
pnpm --filter @icemarkets/indexer dev       # REST API
pnpm --filter @icemarkets/indexer webhook   # webhook receiver, separate process
```

## What's stubbed vs. real

- `schema.sql` is the full table set from `docs/CONTRACTS.md` §5, ready for production data.
- `server.ts` queries real tables, but a handful of derived fields (24h price change, curve-fill %,
  per-market holder earnings, markets-per-commodity count) are commented as depending on a rollup job
  that isn't built yet — they fall back to `0` until that job (or a materialized view) exists. Everything
  else (trades, candles, leaderboard fee totals, rewards-by-wallet, global stats) reads real aggregates.
- `webhook.ts` ingests every watched-program transaction into `raw_events` (JSONB) unconditionally, so no
  data is lost while event decoding is being finished — decode from there once the IDLs land, no
  re-indexing required.
- Holder time-weighted average balances (`balance_events` → payout epochs) are written by `apps/keeper`'s
  `payouts` job, not this service; the table exists here so both can read/write it.

## Env

See `.env.example` at the repo root: `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_WEBHOOK_AUTH_HEADER`
(optional shared secret), `PORT`, `WEBHOOK_PORT`.
