/**
 * Postgres access for the keeper. Table shapes are owned by `apps/indexer/schema.sql`; the keeper
 * reads/writes a subset: `prices`, `pools`, `commodities`, `balance_events`, `epochs`, `epoch_progress`, `payouts`,
 * `fee_claims`, `buybacks`, `merkle_leaves`, `candles` (read). Rows the indexer also writes from events are
 * inserted idempotently (`on conflict`), so whichever writer lands first wins.
 *
 * UNITS: schema.sql stores token amounts as numeric(30,6) HUMAN units and prices as numeric(20,8)
 * USD. The keeper works in on-chain base units (6 decimals for every COIN / memecoin / USDC) and
 * 1e8 prices, so every read/write below converts in SQL (`/ 1e6`, `* 1e8`, …). The only exception is
 * `merkle_leaves.amount`, which is exact BASE units (it is hashed into the Merkle leaf).
 * `prices.commodity` / `pools.commodity` reference `commodities.symbol`.
 */
import { Pool, type PoolClient } from "pg";
import { loadConfig } from "./config";
import { childLogger } from "./logger";

const log = childLogger("db");

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const cfg = loadConfig();
  pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });
  pool.on("error", (err) => log.error({ err: String(err) }, "idle postgres client error"));
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ---- prices --------------------------------------------------------------

export interface PriceRow {
  commodity: string; // commodities.symbol (FK)
  ts: number; // unix seconds
  price: string; // USD at 1e8, as integer text (converted to/from numeric(20,8) in SQL)
  conf: string; // same scale as price
  source: string; // "pyth" | "keeper" | "switchboard"
}

/** Inserts a price point and mirrors it into commodities.last_price_usd / last_publish_time. */
export async function insertPrice(row: PriceRow): Promise<void> {
  // prices_uniq (commodity, ts, source): the indexer also writes PriceUpdated events for the same post.
  await getPool().query(
    `insert into prices (commodity, ts, price, conf, source) values ($1, to_timestamp($2), $3::numeric / 1e8, $4::numeric / 1e8, $5)
     on conflict (commodity, ts, source) do nothing`,
    [row.commodity, row.ts, row.price, row.conf, row.source],
  );
  await getPool().query(
    `update commodities set last_price_usd = $2::numeric / 1e8, last_publish_time = to_timestamp($3)
     where symbol = $1 and (last_publish_time is null or last_publish_time <= to_timestamp($3))`,
    [row.commodity, row.price, row.ts],
  );
}

/** Latest price for a commodity symbol, returned at 1e8 scale. */
export async function getLatestPrice(commodity: string): Promise<PriceRow | null> {
  const res = await getPool().query(
    `select commodity, extract(epoch from ts)::bigint as ts, round(price * 1e8)::bigint::text as price,
            round(coalesce(conf, 0) * 1e8)::bigint::text as conf, source
     from prices where commodity = $1 order by ts desc limit 1`,
    [commodity],
  );
  const r = res.rows[0];
  return r ? { ...r, ts: Number(r.ts) } : null;
}

// ---- pools -----------------------------------------------------------------

export interface PoolRow {
  dbc_pool: string;
  base_mint: string;
  quote_mint: string;
  commodity: string; // commodities.symbol
  creator: string;
  fee_bps: number;
  created_at: number;
  migrated_at: number | null;
  damm_pool: string | null;
}

export async function listActivePools(): Promise<PoolRow[]> {
  const res = await getPool().query(
    `select dbc_pool, base_mint, quote_mint, commodity, creator, fee_bps,
            extract(epoch from created_at)::bigint as created_at,
            extract(epoch from migrated_at)::bigint as migrated_at,
            damm_pool
     from pools where migrated_at is null`,
  );
  return res.rows;
}

export async function listUnmigratedPools(): Promise<PoolRow[]> {
  return listActivePools();
}

/** Every registered pool (holder vaults keep filling after migration via claim_damm). */
export async function listAllPools(): Promise<PoolRow[]> {
  const res = await getPool().query(
    `select dbc_pool, base_mint, quote_mint, commodity, creator, fee_bps,
            extract(epoch from created_at)::bigint as created_at,
            extract(epoch from migrated_at)::bigint as migrated_at,
            damm_pool
     from pools`,
  );
  return res.rows;
}

export async function listMigratedPools(): Promise<PoolRow[]> {
  const res = await getPool().query(
    `select dbc_pool, base_mint, quote_mint, commodity, creator, fee_bps,
            extract(epoch from created_at)::bigint as created_at,
            extract(epoch from migrated_at)::bigint as migrated_at,
            damm_pool
     from pools where migrated_at is not null`,
  );
  return res.rows;
}

export async function markPoolMigrated(dbcPool: string, dammPool: string): Promise<void> {
  await getPool().query(`update pools set migrated_at = now(), damm_pool = $2 where dbc_pool = $1`, [dbcPool, dammPool]);
}

// ---- balance_events / TWAB inputs ------------------------------------------

export interface BalanceEventRow {
  pool: string;
  wallet: string;
  delta: string; // base units (6 dp) as integer text
  ts: number;
}

export async function getBalanceEvents(pool_: string, startTs: number, endTs: number): Promise<BalanceEventRow[]> {
  const res = await getPool().query(
    `select pool, wallet, round(delta * 1e6)::bigint::text as delta, extract(epoch from ts)::bigint as ts
     from balance_events where pool = $1 and ts >= to_timestamp($2) and ts < to_timestamp($3)
     order by ts asc`,
    [pool_, startTs, endTs],
  );
  return res.rows;
}

/** Balances carried in from before `startTs` (all events strictly before it), used to seed the TWAB's opening balance. */
export async function getBalanceEventsBefore(pool_: string, startTs: number): Promise<BalanceEventRow[]> {
  const res = await getPool().query(
    `select pool, wallet, round(delta * 1e6)::bigint::text as delta, extract(epoch from ts)::bigint as ts
     from balance_events where pool = $1 and ts < to_timestamp($2)
     order by ts asc`,
    [pool_, startTs],
  );
  return res.rows;
}

// ---- epochs / payouts / merkle_leaves --------------------------------------

export interface EpochRow {
  pool: string;
  index: number;
  coin_mint: string;
  start_ts: number;
  end_ts: number;
  total_amount: string; // base units
  pushed_amount: string; // base units
  merkle_root: string | null;
  finalized: boolean;
}

export async function getLastEpoch(pool_: string): Promise<EpochRow | null> {
  const res = await getPool().query(
    `select pool, index, coin_mint, extract(epoch from start_ts)::bigint as start_ts,
            extract(epoch from end_ts)::bigint as end_ts, round(total_amount * 1e6)::bigint::text as total_amount,
            round(pushed_amount * 1e6)::bigint::text as pushed_amount, merkle_root, finalized
     from epochs where pool = $1 order by index desc limit 1`,
    [pool_],
  );
  const r = res.rows[0];
  return r ? { ...r, index: Number(r.index), start_ts: Number(r.start_ts), end_ts: Number(r.end_ts) } : null;
}

/** Upsert: the indexer may already have created the row from the `EpochOpened` event (without start/end). */
export async function insertEpoch(
  row: Omit<EpochRow, "pushed_amount" | "merkle_root" | "finalized"> & { eligible_holders: number; epoch_pubkey: string },
): Promise<void> {
  await getPool().query(
    `insert into epochs (pool, index, coin_mint, start_ts, end_ts, total_amount, pushed_amount, eligible_holders, finalized, epoch_pubkey)
     values ($1, $2, $3, to_timestamp($4), to_timestamp($5), $6::numeric / 1e6, 0, $7, false, $8)
     on conflict (pool, index) do update set coin_mint = excluded.coin_mint, start_ts = excluded.start_ts, end_ts = excluded.end_ts,
       total_amount = excluded.total_amount, eligible_holders = excluded.eligible_holders, epoch_pubkey = excluded.epoch_pubkey`,
    [row.pool, row.index, row.coin_mint, row.start_ts, row.end_ts, row.total_amount, row.eligible_holders, row.epoch_pubkey],
  );
}

export async function markEpochFinalized(
  pool_: string,
  index: number,
  merkleRoot: string,
  pushedAmount: string,
  merkleTotal: string,
): Promise<void> {
  await getPool().query(
    `update epochs set finalized = true, merkle_root = $3, pushed_amount = $4::numeric / 1e6, merkle_total = $5::numeric / 1e6
     where pool = $1 and index = $2`,
    [pool_, index, merkleRoot, pushedAmount, merkleTotal],
  );
}

/** Idempotent on payouts_uniq (pool, epoch, wallet, kind) — the indexer records the same `Payout` events. */
export async function recordPayout(row: {
  pool: string;
  epoch_index: number;
  wallet: string;
  coin_mint: string;
  amount: string; // base units
  kind: 0 | 1; // 0 push, 1 claim
  sig?: string;
}): Promise<void> {
  await getPool().query(
    `insert into payouts (pool, epoch, wallet, coin_mint, amount, kind, ts, sig) values ($1,$2,$3,$4,$5::numeric / 1e6,$6, now(), $7)
     on conflict (pool, epoch, wallet, kind) do nothing`,
    [row.pool, row.epoch_index, row.wallet, row.coin_mint, row.amount, row.kind, row.sig ?? null],
  );
}

/** Wallets already pushed in an epoch (kind 0), amounts in base units. */
export async function getPushedPayouts(pool_: string, epochIndex: number): Promise<{ wallet: string; amount: bigint }[]> {
  const res = await getPool().query<{ wallet: string; amount: string }>(
    `select wallet, round(amount * 1e6)::bigint::text as amount from payouts where pool = $1 and epoch = $2 and kind = 0`,
    [pool_, epochIndex],
  );
  return res.rows.map((r) => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
}

// ---- epoch_progress (resumable payout epochs) --------------------------------------------------

export type EpochPhase = "planned" | "opened" | "pushed" | "finalized";

export interface EpochPlanItem {
  wallet: string;
  amount: bigint; // base units
}

export interface EpochProgressRow {
  pool: string;
  epoch_index: number;
  epoch_pubkey: string;
  coin_mint: string;
  phase: EpochPhase;
  start_ts: number;
  end_ts: number;
  total_amount: bigint;
  plan: EpochPlanItem[];
  merkle_root: string | null;
}

/** Writes the plan BEFORE `open_epoch` is sent (phase 'planned'); re-planning an unopened epoch overwrites it. */
export async function saveEpochPlan(row: Omit<EpochProgressRow, "phase" | "merkle_root">): Promise<void> {
  await getPool().query(
    `insert into epoch_progress (pool, epoch_index, epoch_pubkey, coin_mint, phase, start_ts, end_ts, total_amount, plan, updated_at)
     values ($1,$2,$3,$4,'planned',$5,$6,$7,$8, now())
     on conflict (pool, epoch_index) do update set epoch_pubkey = excluded.epoch_pubkey, coin_mint = excluded.coin_mint,
       start_ts = excluded.start_ts, end_ts = excluded.end_ts, total_amount = excluded.total_amount, plan = excluded.plan,
       phase = 'planned', last_error = null, updated_at = now()
     where epoch_progress.phase = 'planned'`,
    [
      row.pool,
      row.epoch_index,
      row.epoch_pubkey,
      row.coin_mint,
      row.start_ts,
      row.end_ts,
      row.total_amount.toString(),
      JSON.stringify(row.plan.map((p) => ({ wallet: p.wallet, amount: p.amount.toString() }))),
    ],
  );
}

export async function getEpochProgress(pool_: string, epochIndex: number): Promise<EpochProgressRow | null> {
  const res = await getPool().query<{
    pool: string;
    epoch_index: number;
    epoch_pubkey: string;
    coin_mint: string;
    phase: EpochPhase;
    start_ts: string;
    end_ts: string;
    total_amount: string;
    plan: { wallet: string; amount: string }[];
    merkle_root: string | null;
  }>(`select * from epoch_progress where pool = $1 and epoch_index = $2`, [pool_, epochIndex]);
  const r = res.rows[0];
  if (!r) return null;
  return {
    pool: r.pool,
    epoch_index: Number(r.epoch_index),
    epoch_pubkey: r.epoch_pubkey,
    coin_mint: r.coin_mint,
    phase: r.phase,
    start_ts: Number(r.start_ts),
    end_ts: Number(r.end_ts),
    total_amount: BigInt(r.total_amount),
    plan: r.plan.map((p) => ({ wallet: p.wallet, amount: BigInt(p.amount) })),
    merkle_root: r.merkle_root,
  };
}

export async function setEpochPhase(
  pool_: string,
  epochIndex: number,
  phase: EpochPhase,
  extra: { open_sig?: string; finalize_sig?: string; merkle_root?: string; last_error?: string | null } = {},
): Promise<void> {
  await getPool().query(
    `update epoch_progress set phase = $3, open_sig = coalesce($4, open_sig), finalize_sig = coalesce($5, finalize_sig),
       merkle_root = coalesce($6, merkle_root), last_error = $7, updated_at = now()
     where pool = $1 and epoch_index = $2`,
    [pool_, epochIndex, phase, extra.open_sig ?? null, extra.finalize_sig ?? null, extra.merkle_root ?? null, extra.last_error ?? null],
  );
}

export async function setEpochError(pool_: string, epochIndex: number, error: string): Promise<void> {
  await getPool().query(`update epoch_progress set last_error = $3, updated_at = now() where pool = $1 and epoch_index = $2`, [pool_, epochIndex, error.slice(0, 2000)]);
}

/** Highest epoch index the db knows about for a pool (epochs ∪ epoch_progress), or -1. */
export async function getMaxKnownEpochIndex(pool_: string): Promise<number> {
  const res = await getPool().query<{ max: number | null }>(
    `select greatest((select max(index) from epochs where pool = $1), (select max(epoch_index) from epoch_progress where pool = $1)) as max`,
    [pool_],
  );
  const m = res.rows[0]?.max;
  return m === null || m === undefined ? -1 : Number(m);
}

// ---- memecoin USD price (payout min-holding filter) -----------------------------------------------

/**
 * Latest candle close (memecoin price in COIN, any timeframe, newest bucket first) as a decimal string,
 * or null when the pool has no candles yet (candles.ts not running / no trades).
 */
export async function getLatestCandleClose(pool_: string): Promise<{ close: string; ts: number } | null> {
  const res = await getPool().query<{ c: string; ts: string }>(
    `select c::text as c, extract(epoch from ts)::bigint as ts from candles where pool = $1 and c > 0 order by ts desc, tf asc limit 1`,
    [pool_],
  );
  const r = res.rows[0];
  return r ? { close: r.c, ts: Number(r.ts) } : null;
}

export interface MerkleLeafRow {
  pool: string;
  epoch_index: number;
  epoch_pubkey: string;
  wallet: string;
  coin_mint: string;
  amount: string; // exact BASE units (Merkle leaf)
  proof: string[]; // hex-encoded sibling hashes
}

export async function insertMerkleLeaves(rows: MerkleLeafRow[]): Promise<void> {
  if (rows.length === 0) return;
  await withClient(async (client) => {
    await client.query("begin");
    try {
      for (const r of rows) {
        await client.query(
          `insert into merkle_leaves (pool, epoch_index, epoch_pubkey, wallet, coin_mint, amount, proof)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (pool, epoch_index, wallet) do update set amount = excluded.amount, proof = excluded.proof`,
          [r.pool, r.epoch_index, r.epoch_pubkey, r.wallet, r.coin_mint, r.amount, JSON.stringify(r.proof)],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

// ---- fee_claims / buybacks --------------------------------------------------

/** Idempotent on (sig, pool, source) — the indexer records the same `FeesClaimed` event. */
export async function recordFeeClaim(row: {
  pool: string;
  source: 0 | 1 | 2; // 0 dbc, 1 surplus, 2 damm
  quote_amount: string; // base units
  base_amount: string; // base units
  sig: string;
}): Promise<void> {
  await getPool().query(
    `insert into fee_claims (pool, source, quote_amount, base_amount, ts, sig) values ($1,$2,$3::numeric / 1e6,$4::numeric / 1e6, now(), $5)
     on conflict (sig, pool, source) do nothing`,
    [row.pool, row.source, row.quote_amount, row.base_amount, row.sig],
  );
}

/** Idempotent on sig — the indexer records the same `Buyback` event. */
export async function recordBuyback(row: {
  coin_mint: string;
  coin_amount: string; // base units
  gld_amount: string; // base units
  ice_burned: string; // base units
  sig: string;
}): Promise<void> {
  await getPool().query(
    `insert into buybacks (coin_mint, coin_amount, gld_amount, ice_burned, ts, sig)
     values ($1,$2::numeric / 1e6,$3::numeric / 1e6,$4::numeric / 1e6, now(), $5)
     on conflict (sig) do nothing`,
    [row.coin_mint, row.coin_amount, row.gld_amount, row.ice_burned, row.sig],
  );
}

// ---- commodities (mirror of the on-chain set, for the session/oracle cycles) ----------

export interface CommodityRow {
  symbol: string;
  commodity_pubkey: string;
  /** On-chain Status discriminant (0 Open / 1 Closed / 2 Halted); stored as text in schema.sql. */
  status: number;
  session_kind: number;
  oracle_kind: number;
  feed_account: string | null;
}

const STATUS_TEXT = ["open", "closed", "halted"] as const;

export async function listCommodities(): Promise<CommodityRow[]> {
  const res = await getPool().query(
    `select symbol, commodity_pubkey,
            case status when 'open' then 0 when 'closed' then 1 else 2 end as status,
            session_kind, oracle_kind, feed_account
     from commodities where commodity_pubkey is not null`,
  );
  return res.rows.map((r) => ({ ...r, status: Number(r.status), session_kind: Number(r.session_kind), oracle_kind: Number(r.oracle_kind) }));
}

export async function updateCommodityStatus(symbol: string, status: number): Promise<void> {
  await getPool().query(`update commodities set status = $2 where symbol = $1`, [symbol, STATUS_TEXT[status] ?? "halted"]);
}

export async function updateCommodityFeedAccount(symbol: string, feedAccount: string): Promise<void> {
  await getPool().query(`update commodities set feed_account = $2 where symbol = $1`, [symbol, feedAccount]);
}
