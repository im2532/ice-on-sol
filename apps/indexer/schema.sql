-- ICEmarkets indexer schema. Source of truth: docs/CONTRACTS.md §5 "Indexer tables".
-- Postgres 15+. All monetary amounts are numeric to avoid float drift; prices are
-- numeric(20,8) matching the on-chain PRICE_EXPO = -8 convention (1e8 = $1.00), stored already
-- divided down to human units for API convenience.
-- UNITS: token amounts numeric(30,6) are HUMAN units (base units / 1e6 — every ICEmarkets coin, memecoin
-- and USDC has 6 decimals). Writers (apps/keeper/src/db.ts, webhook) convert. Exception:
-- merkle_leaves.amount is exact BASE units because it is hashed into the Merkle leaf.

create table if not exists commodities (
  symbol            text primary key,           -- matches packages/registry Commodity.symbol
  name              text not null,
  display_name      text,
  category          text not null,
  emoji             text not null,
  unit              text not null,
  unit_short        text not null,
  mint              text not null unique,
  decimals          smallint not null default 6,
  status            text not null default 'open', -- open | closed | halted
  supply_cap        numeric(30,6) not null default 0,
  supply_outstanding numeric(30,6) not null default 0,
  reserve_balance   numeric(30,6) not null default 0,
  reserve_ratio_bps integer not null default 10000,
  last_price_usd    numeric(20,8),
  last_publish_time timestamptz,
  change_24h        numeric(12,4) not null default 0, -- % change, rollup job
  -- on-chain mirror used by apps/keeper (oracle + session cycles); filled by scripts/seed-commodities.ts
  commodity_pubkey  text unique,                -- peg_desk Commodity PDA
  oracle_kind       smallint,                   -- OracleKind discriminant (registry types.ts)
  session_kind      smallint,                   -- SessionKind discriminant
  feed_account      text,                       -- current Commodity.feed_account
  created_at        timestamptz not null default now()
);
alter table commodities add column if not exists change_24h numeric(12,4) not null default 0;
alter table commodities add column if not exists commodity_pubkey text; -- (unique only on fresh create)
alter table commodities add column if not exists oracle_kind smallint;
alter table commodities add column if not exists session_kind smallint;
alter table commodities add column if not exists feed_account text;

create table if not exists prices (
  id          bigserial primary key,
  commodity   text not null references commodities(symbol),
  ts          timestamptz not null,
  price       numeric(20,8) not null,
  conf        numeric(20,8),
  source      text not null            -- 'pyth' | 'switchboard' | 'keeper'
);
create index if not exists prices_commodity_ts_idx on prices (commodity, ts desc);

create table if not exists pools (
  dbc_pool     text primary key,
  base_mint    text not null unique,   -- memecoin mint
  quote_mint   text not null,          -- commodity coin mint
  commodity    text not null references commodities(symbol),
  creator      text not null,
  fee_bps      integer not null,
  ticker       text not null,
  name         text not null,
  image_uri    text,
  website      text, x text, telegram text, description text,
  created_at   timestamptz not null default now(),
  migrated_at  timestamptz,
  damm_pool    text,
  -- rollup columns (written by the candles/rollup job; read by GET /markets)
  last_price_quote     numeric(38,18) not null default 0, -- memecoin price in COIN
  change_24h           numeric(12,4)  not null default 0, -- %
  volume_24h_usd       numeric(20,2)  not null default 0,
  curve_progress_pct   numeric(6,2)   not null default 0,
  holder_earnings_coin numeric(30,6)  not null default 0
);
alter table pools add column if not exists last_price_quote numeric(38,18) not null default 0;
alter table pools add column if not exists change_24h numeric(12,4) not null default 0;
alter table pools add column if not exists volume_24h_usd numeric(20,2) not null default 0;
alter table pools add column if not exists curve_progress_pct numeric(6,2) not null default 0;
alter table pools add column if not exists holder_earnings_coin numeric(30,6) not null default 0;
create index if not exists pools_commodity_idx on pools (commodity);
create index if not exists pools_created_at_idx on pools (created_at desc);

create table if not exists trades (
  sig          text primary key,
  pool         text not null references pools(dbc_pool),
  ts           timestamptz not null,
  side         smallint not null,      -- 0 buy, 1 sell (matches Trade event in CONTRACTS §1)
  base         numeric(30,6) not null, -- memecoin amount
  quote        numeric(30,6) not null, -- commodity coin amount
  price_quote  numeric(38,18) not null, -- price in commodity coin (memecoin prices are ~1e-9 COIN)
  price_usd    numeric(38,18) not null,
  trader       text not null
);
create index if not exists trades_pool_ts_idx on trades (pool, ts desc);

create table if not exists candles (
  pool  text not null references pools(dbc_pool),
  tf    text not null,   -- '1m' | '5m' | '1h' | '1d'
  ts    timestamptz not null,
  o     numeric(38,18) not null,
  h     numeric(38,18) not null,
  l     numeric(38,18) not null,
  c     numeric(38,18) not null,
  v     numeric(30,6) not null default 0,
  primary key (pool, tf, ts)
);

create table if not exists balances (
  pool          text not null references pools(dbc_pool),
  wallet        text not null,
  amount        numeric(30,6) not null default 0,
  updated_slot  bigint not null default 0,
  primary key (pool, wallet)
);

-- Raw balance deltas, replayed into time-weighted average balances for payout epochs.
create table if not exists balance_events (
  id      bigserial primary key,
  pool    text not null references pools(dbc_pool),
  wallet  text not null,
  delta   numeric(30,6) not null,
  slot    bigint not null,
  ts      timestamptz not null
);
create index if not exists balance_events_pool_wallet_idx on balance_events (pool, wallet, ts);

create table if not exists epochs (
  pool            text not null references pools(dbc_pool),
  index           integer not null,
  coin_mint       text not null,
  start_ts        timestamptz not null,
  end_ts          timestamptz not null,
  total_amount    numeric(30,6) not null default 0,
  pushed_amount   numeric(30,6) not null default 0,
  merkle_root     text,
  merkle_total    numeric(30,6) not null default 0,
  claimed_amount  numeric(30,6) not null default 0,
  eligible_holders integer not null default 0,
  finalized       boolean not null default false,
  primary key (pool, index)
);

create table if not exists payouts (
  id      bigserial primary key,
  pool    text not null references pools(dbc_pool),
  epoch   integer not null,
  wallet  text not null,
  coin_mint text not null,
  amount  numeric(30,6) not null,
  kind    smallint not null,  -- 0 push, 1 claim
  ts      timestamptz not null default now()
);
create index if not exists payouts_wallet_idx on payouts (wallet);
create index if not exists payouts_pool_idx on payouts (pool);

-- Merkle claim leaves written by apps/keeper payouts cycle; served to the web claim flow.
create table if not exists merkle_leaves (
  pool          text not null references pools(dbc_pool),
  epoch_index   integer not null,
  epoch_pubkey  text not null,            -- distributor Epoch PDA
  wallet        text not null,
  coin_mint     text not null,
  amount        numeric(30,0) not null,   -- BASE units (exact; part of the leaf hash)
  proof         jsonb not null,           -- ["hex32", ...] leaf -> root
  claimed       boolean not null default false,
  primary key (pool, epoch_index, wallet)
);
create index if not exists merkle_leaves_wallet_idx on merkle_leaves (wallet) where not claimed;

create table if not exists fee_claims (
  id            bigserial primary key,
  pool          text not null references pools(dbc_pool),
  source        smallint not null, -- 0 dbc, 1 surplus, 2 damm
  quote_amount  numeric(30,6) not null,
  base_amount   numeric(30,6) not null default 0,
  ts            timestamptz not null default now()
);

create table if not exists buybacks (
  id            bigserial primary key,
  coin_mint     text not null,
  coin_amount   numeric(30,6) not null,
  gld_amount    numeric(30,6) not null,
  ice_burned   numeric(30,6) not null,
  ts            timestamptz not null default now()
);

-- Cursor for Helius webhook / backfill idempotency.
create table if not exists ingest_cursor (
  source      text primary key,   -- 'helius_webhook' | 'backfill:<address>'
  last_sig    text,
  last_slot   bigint,
  updated_at  timestamptz not null default now()
);

-- =====================================================================================================
-- v0.2 additions (all additive / widening — safe to re-run on an existing v0.1 database).
-- Writers: apps/indexer/src/decode/* (webhook + backfill) and apps/keeper. Both write some of the same
-- facts (payouts, fee claims, buybacks, prices, epochs), so every such table has a natural unique key and
-- both writers use `on conflict do nothing|update` — whichever lands first wins, replays are no-ops.
-- NOTE: the unique indexes below fail to build if a v0.1 database already holds duplicate rows; dedupe first.
-- =====================================================================================================

-- Memecoin prices in COIN are ~1e-9 (a $5k-cap, 1e9-supply coin quoted in a $2.6k GLD), which
-- numeric(20,8) rounds to 0. Widen (lossless) to 18 decimals.
alter table trades  alter column price_quote type numeric(38,18);
alter table trades  alter column price_usd   type numeric(38,18);
alter table candles alter column o type numeric(38,18);
alter table candles alter column h type numeric(38,18);
alter table candles alter column l type numeric(38,18);
alter table candles alter column c type numeric(38,18);
alter table pools   alter column last_price_quote type numeric(38,18);

-- Token vaults of the DBC pool and (post-migration) the DAMM v2 pool, derived at PoolRegistered /
-- MigrationRecorded time. The swap decoder matches pre/post token balances of these accounts.
alter table pools add column if not exists base_vault       text;
alter table pools add column if not exists quote_vault      text;
alter table pools add column if not exists damm_base_vault  text;
alter table pools add column if not exists damm_quote_vault text;
alter table pools add column if not exists registered_sig   text;
create index if not exists pools_base_vault_idx on pools (base_vault);
create index if not exists pools_damm_base_vault_idx on pools (damm_base_vault);

-- Idempotency keys.
alter table balance_events add column if not exists sig text;
create unique index if not exists balance_events_sig_uniq on balance_events (pool, wallet, sig);
alter table fee_claims add column if not exists sig text;
create unique index if not exists fee_claims_sig_uniq on fee_claims (sig, pool, source);
alter table buybacks add column if not exists sig text;
create unique index if not exists buybacks_sig_uniq on buybacks (sig);
alter table payouts add column if not exists sig text;
create unique index if not exists payouts_uniq on payouts (pool, epoch, wallet, kind);
create unique index if not exists prices_uniq on prices (commodity, ts, source);

-- distributor Epoch PDA (lets Payout{epoch} events map back to (pool, index)).
alter table epochs add column if not exists epoch_pubkey text;
create unique index if not exists epochs_pubkey_uniq on epochs (epoch_pubkey);

-- peg_desk `Trade` events (commodity coin ↔ USDC on the Peg Desk; memecoin trades live in `trades`).
create table if not exists commodity_trades (
  sig         text not null,
  commodity   text not null references commodities(symbol),
  ts          timestamptz not null,
  side        smallint not null,          -- 0 buy (mint), 1 sell (burn)
  usdc        numeric(30,6) not null,
  coin        numeric(30,6) not null,
  price       numeric(20,8) not null,     -- oracle mid, USD
  spread_bps  integer not null,
  trader      text not null,
  primary key (sig, commodity, trader, side)
);
create index if not exists commodity_trades_commodity_ts_idx on commodity_trades (commodity, ts desc);

-- fee_router `FeesSplit` events.
create table if not exists fee_splits (
  sig       text not null,
  pool      text not null references pools(dbc_pool),
  holders   numeric(30,6) not null,
  buyback   numeric(30,6) not null,
  protocol  numeric(30,6) not null,
  ts        timestamptz not null,
  primary key (sig, pool)
);

-- Keeper payout-epoch progress (apps/keeper/src/cycles/payouts.ts). The share PLAN is persisted before
-- `open_epoch` is sent, so a crashed cycle resumes the exact same allocation instead of recomputing TWAB.
create table if not exists epoch_progress (
  pool          text not null references pools(dbc_pool),
  epoch_index   integer not null,
  epoch_pubkey  text not null,
  coin_mint     text not null,
  phase         text not null,            -- planned | opened | pushed | finalized
  start_ts      bigint not null,          -- unix seconds
  end_ts        bigint not null,
  total_amount  numeric(30,0) not null,   -- BASE units
  plan          jsonb not null,           -- [{ "wallet": base58, "amount": "<base units>" }, …] (sum = total)
  open_sig      text,
  finalize_sig  text,
  merkle_root   text,
  last_error    text,
  updated_at    timestamptz not null default now(),
  primary key (pool, epoch_index)
);

-- Raw audit trail of every ingested transaction (was created lazily by webhook.ts in v0.1).
create table if not exists raw_events (
  sig      text primary key,
  slot     bigint,
  ts       timestamptz,
  payload  jsonb,
  error    text            -- decode/ingest error (tx skipped; replay with backfill after fixing)
);
alter table raw_events add column if not exists error text;
