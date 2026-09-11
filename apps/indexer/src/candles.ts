import { pool } from "./db";

/**
 * Aggregates apps/indexer `trades` rows into OHLCV `candles`, per docs/CONTRACTS.md §5
 * ("apps/keeper" candles job). Run on a schedule (cron / keeper interval) — `pnpm --filter
 * @icemarkets/indexer candles` runs one pass and exits, suitable for a 1-minute cron.
 */

const TIMEFRAMES: { tf: string; bucketSql: string }[] = [
  { tf: "1m", bucketSql: "date_trunc('minute', ts)" },
  { tf: "5m", bucketSql: "to_timestamp(floor(extract(epoch from ts) / 300) * 300)" },
  { tf: "1h", bucketSql: "date_trunc('hour', ts)" },
  { tf: "1d", bucketSql: "date_trunc('day', ts)" },
];

async function rebuildCandles(tf: string, bucketSql: string, sinceHours = 48) {
  // first/last-in-bucket trick: order by ts, take first row per bucket for open, last for close.
  await pool.query(
    `
    with buckets as (
      select pool,
             ${bucketSql} as ts,
             price_quote,
             sig,
             base,
             row_number() over (partition by pool, ${bucketSql} order by ts asc)  as rn_asc,
             row_number() over (partition by pool, ${bucketSql} order by ts desc) as rn_desc
      from trades
      where ts > now() - interval '${sinceHours} hours'
    ),
    agg as (
      select pool, ts,
             max(price_quote) filter (where rn_asc = 1)  as o,
             max(price_quote)                            as h,
             min(price_quote)                            as l,
             max(price_quote) filter (where rn_desc = 1) as c,
             sum(base)                                   as v
      from buckets
      group by pool, ts
    )
    insert into candles (pool, tf, ts, o, h, l, c, v)
    select pool, $1, ts, o, h, l, c, v from agg
    on conflict (pool, tf, ts) do update
      set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v
    `,
    [tf]
  );
}

/** Refreshes the pools rollup columns read by GET /markets (schema.sql "rollup columns"). */
async function refreshPoolRollups() {
  await pool.query(`
    update pools p set
      last_price_quote = coalesce((select t.price_quote from trades t where t.pool = p.dbc_pool order by t.ts desc limit 1), p.last_price_quote),
      volume_24h_usd = coalesce((select sum(t.price_usd * t.base) from trades t where t.pool = p.dbc_pool and t.ts > now() - interval '24 hours'), 0),
      change_24h = coalesce((
        select case when o.price_quote > 0 then (p.last_price_quote / o.price_quote - 1) * 100 else 0 end
        from (select t.price_quote from trades t where t.pool = p.dbc_pool and t.ts > now() - interval '24 hours' order by t.ts asc limit 1) o
      ), 0),
      holder_earnings_coin = coalesce((select sum(po.amount) from payouts po where po.pool = p.dbc_pool), 0)
        + coalesce((select sum(ml.amount) / 1e6 from merkle_leaves ml where ml.pool = p.dbc_pool and not ml.claimed), 0)
  `);
}

async function main() {
  for (const { tf, bucketSql } of TIMEFRAMES) {
    await rebuildCandles(tf, bucketSql);
    // eslint-disable-next-line no-console
    console.log(`candles: rebuilt ${tf}`);
  }
  await refreshPoolRollups();
  // eslint-disable-next-line no-console
  console.log("candles: refreshed pool rollups");
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
