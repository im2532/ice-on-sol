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
  last_price_quote     numeric(30,12) not null default 0, -- memecoin price in COIN
  change_24h           numeric(12,4)  not null default 0, -- %
  volume_24h_usd       numeric(20,2)  not null default 0,
  curve_progress_pct   numeric(6,2)   not null default 0,
  holder_earnings_coin numeric(30,6)  not null default 0
);
alter table pools add column if not exists last_price_quote numeric(30,12) not null default 0;
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
  price_quote  numeric(20,8) not null, -- price in commodity coin
  price_usd    numeric(20,8) not null,
  trader       text not null
);
create index if not exists trades_pool_ts_idx on trades (pool, ts desc);

create table if not exists candles (
  pool  text not null references pools(dbc_pool),
  tf    text not null,   -- '1m' | '5m' | '1h' | '1d'
  ts    timestamptz not null,
  o     numeric(20,8) not null,
  h     numeric(20,8) not null,
  l     numeric(20,8) not null,
  c     numeric(20,8) not null,
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
  source      text primary key,   -- 'helius_webhook' | 'backfill'
  last_sig    text,
  last_slot   bigint,
  updated_at  timestamptz not null default now()
);
