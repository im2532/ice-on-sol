import Fastify from "fastify";
import cors from "@fastify/cors";
import { FEE_SPLIT_BPS } from "@icemarkets/registry";
import { query, queryOne } from "./db";

/**
 * REST API matching apps/web/lib/api.ts fetchers 1:1. Reads Postgres tables from schema.sql.
 * Values are pre-aggregated by the keeper/webhook ingest pipeline (apps/keeper), not computed here —
 * this service is read-mostly to keep response times low under the indexer's own load.
 */

const PORT = Number(process.env.PORT ?? 4000);

const app = Fastify({ logger: true });

async function start() {
  await app.register(cors, { origin: true });

  // ---- /markets --------------------------------------------------------
  app.get("/markets", async (req) => {
    const q = req.query as {
      q?: string; tab?: "all" | "new" | "migrated"; sort?: string; page?: string; pageSize?: string;
    };
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(q.pageSize ?? 8)));
    const offset = (page - 1) * pageSize;

    const where: string[] = [];
    const params: unknown[] = [];
    if (q.q) {
      params.push(`%${q.q.toLowerCase()}%`);
      where.push(`(lower(p.ticker) like $${params.length} or lower(p.name) like $${params.length} or lower(p.commodity) like $${params.length})`);
    }
    if (q.tab === "new") where.push(`p.created_at > now() - interval '3 days'`);
    if (q.tab === "migrated") where.push(`p.migrated_at is not null`);

    // fdv = COIN usd price × memecoin price in COIN × 1e9 supply (same formula as toMarketDto)
    const fdvSql = "(coalesce(c.last_price_usd, 0) * p.last_price_quote)";
    const orderBy =
      q.sort === "mcap_asc" ? `${fdvSql} asc` :
      q.sort === "vol_desc" ? "p.volume_24h_usd desc" :
      q.sort === "new" ? "p.created_at desc" :
      `${fdvSql} desc`;

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    const total = await queryOne<{ count: string }>(
      `select count(*) from pools p join commodities c on c.symbol = p.commodity ${whereSql}`,
      params
    );
    params.push(pageSize, offset);
    const rows = await query(
      `select p.*, c.emoji as commodity_emoji, c.name as commodity_name, c.last_price_usd as commodity_price_usd
       from pools p join commodities c on c.symbol = p.commodity
       ${whereSql}
       order by ${orderBy}
       limit $${params.length - 1} offset $${params.length}`,
      params
    );
    return { markets: rows.map(toMarketDto), total: Number(total?.count ?? 0) };
  });

  app.get("/markets/:mint", async (req, reply) => {
    const { mint } = req.params as { mint: string };
    const row = await queryOne(
      `select p.*, c.emoji as commodity_emoji, c.name as commodity_name, c.last_price_usd as commodity_price_usd
       from pools p join commodities c on c.symbol = p.commodity
       where p.base_mint = $1`,
      [mint]
    );
    if (!row) return reply.code(404).send({ error: "not found" });
    return toMarketDto(row);
  });

  // ---- /commodities ------------------------------------------------------
  const COMMODITY_SELECT = `select c.*, (select count(*) from pools p where p.commodity = c.symbol) as markets_count from commodities c`;

  app.get("/commodities", async () => {
    const rows = await query(`${COMMODITY_SELECT} order by c.category, c.symbol`);
    return rows.map(toCommodityDto);
  });

  app.get("/commodities/:symbol", async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const row = await queryOne(`${COMMODITY_SELECT} where c.symbol = $1`, [symbol.toUpperCase()]);
    if (!row) return reply.code(404).send({ error: "not found" });
    return toCommodityDto(row);
  });

  app.get("/commodities/:symbol/price-history", async (req) => {
    const { symbol } = req.params as { symbol: string };
    const { range } = req.query as { range?: "24h" | "7d" | "30d" };
    const interval = range === "7d" ? "7 days" : range === "30d" ? "30 days" : "24 hours";
    const rows = await query<{ ts: Date; price: string }>(
      `select ts, price from prices where commodity = $1 and ts > now() - interval '${interval}' order by ts asc`,
      [symbol.toUpperCase()]
    );
    return rows.map((r) => ({ ts: Math.floor(r.ts.getTime() / 1000), price: Number(r.price) }));
  });

  // ---- /trades and /candles ----------------------------------------------
  app.get("/trades/:mint", async (req) => {
    const { mint } = req.params as { mint: string };
    const pool = await queryOne<{ dbc_pool: string }>(`select dbc_pool from pools where base_mint = $1`, [mint]);
    if (!pool) return [];
    const rows = await query(
      `select * from trades where pool = $1 order by ts desc limit 100`,
      [pool.dbc_pool]
    );
    return rows.map(toTradeDto);
  });

  app.get("/candles/:mint", async (req) => {
    const { mint } = req.params as { mint: string };
    const { tf = "5m" } = req.query as { tf?: string };
    const pool = await queryOne<{ dbc_pool: string }>(`select dbc_pool from pools where base_mint = $1`, [mint]);
    if (!pool) return [];
    const rows = await query(
      `select * from candles where pool = $1 and tf = $2 order by ts asc limit 500`,
      [pool.dbc_pool, tf]
    );
    return rows.map(toCandleDto);
  });

  // ---- /rewards ------------------------------------------------------
  app.get("/rewards/leaderboard", async () => {
    // Holders' share of claimed fees = quote fees × FEE_SPLIT_BPS.holders (fee_router split).
    const holdersFrac = FEE_SPLIT_BPS.holders / 10_000;
    const rows = await query(
      `select p.dbc_pool, p.base_mint, p.ticker, p.name, p.image_uri, p.commodity, c.emoji as commodity_emoji,
              coalesce(f.fee_amount_coin, 0) as fee_amount_coin,
              coalesce(f.fee_amount_coin, 0) * $1 * coalesce(c.last_price_usd, 0) as holder_share_usd
       from pools p
       join commodities c on c.symbol = p.commodity
       left join (select pool, sum(quote_amount) as fee_amount_coin from fee_claims group by pool) f on f.pool = p.dbc_pool
       order by holder_share_usd desc
       limit 200`,
      [holdersFrac]
    );
    return rows.map((r: any, i: number) => ({
      rank: i + 1,
      mint: r.base_mint,
      ticker: r.ticker,
      name: r.name,
      image: r.image_uri ?? "🪙",
      pairedWith: r.commodity,
      pairedEmoji: r.commodity_emoji,
      feeAmountCoin: Number(r.fee_amount_coin),
      feeCoinSymbol: r.commodity,
      holderShareUsd: Number(r.holder_share_usd),
    }));
  });

  // Earned = pushed + claimed payouts (payouts table) + still-unclaimed Merkle leaves; claimable = the latter.
  app.get("/rewards/:wallet", async (req) => {
    const { wallet } = req.params as { wallet: string };
    const rows = await query<{ symbol: string; emoji: string; price: string | null; paid: string; claimable: string }>(
      `select c.symbol, c.emoji, c.last_price_usd as price,
              coalesce((select sum(po.amount) from payouts po where po.wallet = $1 and po.coin_mint = c.mint), 0) as paid,
              coalesce((select sum(ml.amount) / 1e6 from merkle_leaves ml where ml.wallet = $1 and ml.coin_mint = c.mint and not ml.claimed), 0) as claimable
       from commodities c
       where exists (select 1 from payouts po where po.wallet = $1 and po.coin_mint = c.mint)
          or exists (select 1 from merkle_leaves ml where ml.wallet = $1 and ml.coin_mint = c.mint)`,
      [wallet]
    );
    const byCoin = rows.map((r) => {
      const claimable = Number(r.claimable);
      return { symbol: r.symbol, emoji: r.emoji, amount: Number(r.paid) + claimable, claimable };
    });
    const totalEarnedUsd = rows.reduce((sum, r, i) => sum + byCoin[i].amount * Number(r.price ?? 0), 0);
    return { wallet, totalEarnedUsd, byCoin };
  });

  // Unclaimed Merkle leaves with proofs — input for the distributor `claim` ix (apps/web lib/actions.ts).
  app.get("/rewards/:wallet/claims", async (req) => {
    const { wallet } = req.params as { wallet: string };
    const rows = await query<{ pool: string; epoch_index: number; epoch_pubkey: string; coin_mint: string; amount: string; proof: string[]; symbol: string | null }>(
      `select ml.pool, ml.epoch_index, ml.epoch_pubkey, ml.coin_mint, ml.amount::text as amount, ml.proof, c.symbol
       from merkle_leaves ml left join commodities c on c.mint = ml.coin_mint
       where ml.wallet = $1 and not ml.claimed
       order by ml.pool, ml.epoch_index`,
      [wallet]
    );
    return rows.map((r) => ({
      pool: r.pool,
      epochIndex: Number(r.epoch_index),
      epoch: r.epoch_pubkey,
      coinMint: r.coin_mint,
      coinSymbol: r.symbol ?? "",
      amount: r.amount, // base units, exact (u64 as string)
      proof: r.proof, // hex strings, leaf -> root
    }));
  });

  // ---- /stats ------------------------------------------------------
  app.get("/stats", async () => {
    const [markets, commodities, vol, tvl, paid, buyback] = await Promise.all([
      queryOne<{ count: string }>(`select count(*) from pools`),
      queryOne<{ count: string }>(`select count(*) from commodities`),
      queryOne<{ sum: string }>(`select coalesce(sum(price_usd * base), 0) as sum from trades where ts > now() - interval '24 hours'`),
      queryOne<{ sum: string }>(`select coalesce(sum(reserve_balance), 0) as sum from commodities`),
      // payouts.amount is in COIN units → value at each coin's last USD price.
      queryOne<{ total: string; day: string; wallets: string }>(
        `select coalesce(sum(po.amount * coalesce(c.last_price_usd, 0)),0) as total,
                coalesce(sum(po.amount * coalesce(c.last_price_usd, 0)) filter (where po.ts > now() - interval '24 hours'),0) as day,
                count(distinct po.wallet) as wallets
         from payouts po left join commodities c on c.mint = po.coin_mint`
      ),
      // buybacks.gld_amount is GLD units → × GLD price.
      queryOne<{ usd: string; burned: string }>(
        `select coalesce(sum(b.gld_amount),0) * coalesce((select last_price_usd from commodities where symbol = 'GLD'), 0) as usd,
                coalesce(sum(b.ice_burned),0) as burned
         from buybacks b where b.ts > now() - interval '24 hours'`
      ),
    ]);
    return {
      marketsCount: Number(markets?.count ?? 0),
      commoditiesCount: Number(commodities?.count ?? 0),
      volume24hUsd: Number(vol?.sum ?? 0),
      valueLockedUsd: Number(tvl?.sum ?? 0),
      paidToHoldersUsd: Number(paid?.total ?? 0),
      paidToHolders24hUsd: Number(paid?.day ?? 0),
      holderWallets: Number(paid?.wallets ?? 0),
      iceBoughtBackUsd: Number(buyback?.usd ?? 0),
      iceBurned: Number(buyback?.burned ?? 0),
      iceBurnedPct: 0,
      iceMcapUsd: 0,
      icePriceGld: 0,
    };
  });

  app.get("/healthz", async () => ({ ok: true }));

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

// ---- DTO mappers (snake_case rows -> camelCase API shapes matching apps/web/lib/types.ts) ----
// NOTE: pools.last_price_quote / change_24h / volume_24h_usd / holder_earnings_coin are rollup columns
// (schema.sql) refreshed by src/candles.ts; curve_progress_pct needs the DBC curve state (TODO in the
// webhook ingester) and stays 0 until then. commodities.markets_count is a subquery (COMMODITY_SELECT).
function toMarketDto(r: any) {
  const fdvUsd = Number(r.commodity_price_usd ?? 0) * Number(r.last_price_quote ?? 0) * 1_000_000_000;
  return {
    mint: r.base_mint,
    ticker: r.ticker,
    name: r.name,
    image: r.image_uri ?? "🪙",
    commoditySymbol: r.commodity,
    commodityEmoji: r.commodity_emoji,
    commodityName: r.commodity_name,
    pairedWith: r.commodity,
    fdvUsd,
    priceQuote: Number(r.last_price_quote ?? 0),
    priceUsd: fdvUsd / 1_000_000_000,
    change24h: Number(r.change_24h ?? 0),
    volume24hUsd: Number(r.volume_24h_usd ?? 0),
    curveProgressPct: r.migrated_at ? 100 : Number(r.curve_progress_pct ?? 0),
    migrated: !!r.migrated_at,
    createdAt: new Date(r.created_at).toISOString(),
    feeBps: r.fee_bps,
    creator: r.creator,
    dbcPool: r.dbc_pool,
    dammPool: r.damm_pool ?? undefined,
    holderEarningsCoin: Number(r.holder_earnings_coin ?? 0),
  };
}

function toCommodityDto(r: any) {
  return {
    symbol: r.symbol,
    name: r.name,
    displayName: r.display_name ?? undefined,
    category: r.category,
    emoji: r.emoji,
    unit: r.unit,
    unitShort: r.unit_short,
    priceUsd: Number(r.last_price_usd ?? 0),
    change24h: Number(r.change_24h ?? 0),
    marketsCount: Number(r.markets_count ?? 0),
    status: r.status,
    lastPublishedAgoSec: r.last_publish_time
      ? Math.floor((Date.now() - new Date(r.last_publish_time).getTime()) / 1000)
      : 0,
    supplyCap: Number(r.supply_cap ?? 0),
    supplyOutstanding: Number(r.supply_outstanding ?? 0),
    reserveRatioBps: Number(r.reserve_ratio_bps ?? 10000),
    mint: r.mint,
  };
}

function toTradeDto(r: any) {
  return {
    sig: r.sig,
    ts: Math.floor(new Date(r.ts).getTime() / 1000),
    side: r.side === 0 ? "buy" : "sell",
    baseAmount: Number(r.base),
    quoteAmount: Number(r.quote),
    priceQuote: Number(r.price_quote),
    priceUsd: Number(r.price_usd),
    trader: r.trader,
  };
}

function toCandleDto(r: any) {
  return {
    ts: Math.floor(new Date(r.ts).getTime() / 1000),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: Number(r.v),
  };
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
