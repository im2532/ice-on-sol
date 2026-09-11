/**
 * One transaction → Postgres. Shared by the Helius webhook (webhook.ts) and the RPC backfill (backfill.ts).
 *
 * Order inside a transaction:
 *   1. ICEmarkets Anchor events (peg_desk → fee_router → distributor → buyback), so a `PoolRegistered`
 *      creates the `pools` row before step 2 looks for that pool's vaults (the launch tx swaps first).
 *   2. Meteora DBC / DAMM v2 swaps of registered pools → `trades`.
 *   3. Memecoin balance changes of registered pools → `balance_events` (+ `balances`).
 *
 * Every write is idempotent (unique keys + `on conflict`), so webhook retries and backfill overlap are
 * no-ops. Each transaction runs inside a SAVEPOINT: a tx that fails to decode is logged into
 * `raw_events.error` and skipped instead of poisoning the whole webhook batch.
 *
 * UNITS: schema.sql token columns are human units (base / 1e6), prices numeric USD — conversions are done
 * in SQL (`$n::numeric / 1e6`) or with `baseToHuman` so no float ever touches an amount.
 */
import type { PoolClient } from "pg";
import { Connection, PublicKey } from "@solana/web3.js";
import { bySymbol } from "@icemarkets/registry";
import { decodeAnchorEvents, programIds } from "./anchorEvents";
import { baseToHuman, price1e8ToHuman, type IcemarketsEvent } from "./events";
import { dammTokenVault, dbcTokenVault, fetchTokenMetadata } from "./meteora";
import { decodeBalanceDeltas, decodeSwaps, touchedMints, type PoolRef } from "./swaps";
import type { NormalizedTx } from "./types";

export interface IngestLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

export interface IngestDeps {
  client: PoolClient;
  /** RPC for Metaplex metadata and for fetching logs the Helius enhanced payload lacks. Optional. */
  connection: Connection | null;
  log: IngestLogger;
}

export interface IngestResult {
  events: number;
  trades: number;
  balanceEvents: number;
  error?: string;
}

const STATUS_TEXT = ["open", "closed", "halted"] as const;
const PROGRAM_ORDER = ["peg_desk", "fee_router", "distributor", "buyback"] as const;

let connectionSingleton: Connection | null | undefined;

/** RPC connection from `RPC_URL` (or `HELIUS_API_KEY`), or null when neither is configured. */
export function defaultConnection(): Connection | null {
  if (connectionSingleton !== undefined) return connectionSingleton;
  const url =
    process.env.RPC_URL ??
    (process.env.HELIUS_API_KEY
      ? `https://${process.env.SOLANA_CLUSTER === "mainnet-beta" ? "mainnet" : "devnet"}.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : undefined);
  connectionSingleton = url ? new Connection(url, "confirmed") : null;
  return connectionSingleton;
}

function icemarketsProgramIds(): Set<string> {
  return new Set(Object.values(programIds()));
}

/** Fills `tx.logs` via RPC when the source had none (Helius enhanced) and an ICEmarkets program ran. */
async function ensureLogs(tx: NormalizedTx, deps: IngestDeps): Promise<void> {
  if (tx.logs !== null) return;
  const ours = icemarketsProgramIds();
  if (![...tx.programIds].some((p) => ours.has(p))) return;
  if (!deps.connection) {
    deps.log.warn({ sig: tx.signature }, "ICEmarkets tx without logs and no RPC_URL — Anchor events skipped (use a Helius raw webhook or set RPC_URL)");
    return;
  }
  const full = await deps.connection.getTransaction(tx.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  tx.logs = full?.meta?.logMessages ?? null;
}

export async function ingestTransaction(tx: NormalizedTx, deps: IngestDeps, rawPayload?: unknown): Promise<IngestResult> {
  const { client } = deps;
  const result: IngestResult = { events: 0, trades: 0, balanceEvents: 0 };
  await client.query("savepoint ingest_tx");
  try {
    if (!tx.failed) {
      await ensureLogs(tx, deps);
      if (tx.logs) {
        const events = decodeAnchorEvents(tx.logs, (program, err) =>
          deps.log.warn({ sig: tx.signature, program, err: String(err) }, "event decode failed"),
        );
        events.sort((a, b) => PROGRAM_ORDER.indexOf(a.program) - PROGRAM_ORDER.indexOf(b.program));
        for (const ev of events) {
          await applyEvent(ev, tx, deps);
          result.events++;
        }
      }
      const pools = await loadPoolRefs(client, touchedMints(tx));
      if (pools.length > 0) {
        result.trades = await writeSwaps(tx, pools, deps);
        result.balanceEvents = await writeBalanceDeltas(tx, pools, deps);
      }
    }
    await client.query("release savepoint ingest_tx");
  } catch (err) {
    await client.query("rollback to savepoint ingest_tx");
    result.error = err instanceof Error ? err.message : String(err);
    deps.log.error({ sig: tx.signature, err: result.error }, "ingest failed for tx; recorded in raw_events.error");
  }
  if (rawPayload !== undefined || result.error) {
    await client.query(
      `insert into raw_events (sig, slot, ts, payload, error) values ($1, $2, to_timestamp($3), $4, $5)
       on conflict (sig) do update set error = excluded.error`,
      [tx.signature, tx.slot, tx.blockTime, rawPayload === undefined ? null : JSON.stringify(rawPayload, bigintReplacer), result.error ?? null],
    );
  }
  return result;
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

// ---- lookups -----------------------------------------------------------------------------------

async function symbolForCommodity(client: PoolClient, commodityPubkey: string): Promise<{ symbol: string; oracleKind: number | null } | null> {
  const r = await client.query<{ symbol: string; oracle_kind: number | null }>(
    `select symbol, oracle_kind from commodities where commodity_pubkey = $1`,
    [commodityPubkey],
  );
  return r.rows[0] ? { symbol: r.rows[0].symbol, oracleKind: r.rows[0].oracle_kind } : null;
}

async function poolExists(client: PoolClient, dbcPool: string): Promise<{ baseMint: string; quoteMint: string } | null> {
  const r = await client.query<{ base_mint: string; quote_mint: string }>(`select base_mint, quote_mint from pools where dbc_pool = $1`, [dbcPool]);
  return r.rows[0] ? { baseMint: r.rows[0].base_mint, quoteMint: r.rows[0].quote_mint } : null;
}

interface PoolRow {
  dbc_pool: string;
  base_mint: string;
  quote_mint: string;
  base_vault: string | null;
  quote_vault: string | null;
  damm_pool: string | null;
  damm_base_vault: string | null;
  damm_quote_vault: string | null;
}

/** Registered pools whose memecoin (base mint) is among `mints`; backfills missing vault columns. */
export async function loadPoolRefs(client: PoolClient, mints: string[]): Promise<PoolRef[]> {
  if (mints.length === 0) return [];
  const r = await client.query<PoolRow>(
    `select dbc_pool, base_mint, quote_mint, base_vault, quote_vault, damm_pool, damm_base_vault, damm_quote_vault
     from pools where base_mint = any($1::text[])`,
    [mints],
  );
  const out: PoolRef[] = [];
  for (const p of r.rows) {
    let { base_vault, quote_vault, damm_base_vault, damm_quote_vault } = p;
    if (!base_vault || !quote_vault || (p.damm_pool && (!damm_base_vault || !damm_quote_vault))) {
      base_vault = base_vault ?? dbcTokenVault(p.base_mint, p.dbc_pool);
      quote_vault = quote_vault ?? dbcTokenVault(p.quote_mint, p.dbc_pool);
      if (p.damm_pool) {
        damm_base_vault = damm_base_vault ?? dammTokenVault(p.base_mint, p.damm_pool);
        damm_quote_vault = damm_quote_vault ?? dammTokenVault(p.quote_mint, p.damm_pool);
      }
      await client.query(
        `update pools set base_vault = $2, quote_vault = $3, damm_base_vault = $4, damm_quote_vault = $5 where dbc_pool = $1`,
        [p.dbc_pool, base_vault, quote_vault, damm_base_vault, damm_quote_vault],
      );
    }
    out.push({
      dbcPool: p.dbc_pool,
      baseMint: p.base_mint,
      quoteMint: p.quote_mint,
      baseVault: base_vault,
      quoteVault: quote_vault,
      dammPool: p.damm_pool,
      dammBaseVault: damm_base_vault,
      dammQuoteVault: damm_quote_vault,
    });
  }
  return out;
}

/** Epoch PDA → index, from `epochs`/`merkle_leaves`, else by deriving PDAs for the known index range. */
async function epochIndexFor(client: PoolClient, pool: string, epochPubkey: string): Promise<number | null> {
  const a = await client.query<{ index: number }>(`select index from epochs where epoch_pubkey = $1`, [epochPubkey]);
  if (a.rows[0]) return Number(a.rows[0].index);
  const b = await client.query<{ epoch_index: number }>(`select epoch_index from merkle_leaves where epoch_pubkey = $1 limit 1`, [epochPubkey]);
  if (b.rows[0]) return Number(b.rows[0].epoch_index);
  const m = await client.query<{ max: number | null }>(`select max(index) as max from epochs where pool = $1`, [pool]);
  const upper = Math.min(1024, (m.rows[0]?.max ?? 0) + 2);
  for (let i = 0; i <= upper; i++) if (epochPda(pool, i) === epochPubkey) return i;
  return null;
}

export function epochPda(pool: string, index: number): string {
  const idx = Buffer.alloc(4);
  idx.writeUInt32LE(index >>> 0, 0);
  return PublicKey.findProgramAddressSync([Buffer.from("epoch"), new PublicKey(pool).toBuffer(), idx], new PublicKey(programIds().distributor))[0].toBase58();
}

// ---- events ------------------------------------------------------------------------------------

async function applyEvent(ev: IcemarketsEvent, tx: NormalizedTx, deps: IngestDeps): Promise<void> {
  const { client, log } = deps;
  const ts = tx.blockTime;
  const sig = tx.signature;
  switch (ev.kind) {
    // ---- peg_desk ----
    case "CommodityCreated": {
      const upd = await client.query(`update commodities set commodity_pubkey = $2, mint = $3 where symbol = $1`, [ev.symbol, ev.commodity, ev.mint]);
      if (upd.rowCount === 0) {
        const reg = bySymbol(ev.symbol);
        if (!reg) {
          log.warn({ sig, symbol: ev.symbol }, "CommodityCreated for a symbol not in the registry; skipped");
          return;
        }
        await client.query(
          `insert into commodities (symbol, name, display_name, category, emoji, unit, unit_short, mint, commodity_pubkey, oracle_kind, session_kind)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (symbol) do nothing`,
          [reg.symbol, reg.name, reg.displayName ?? null, reg.category, reg.emoji, reg.unit, reg.unitShort, ev.mint, ev.commodity, reg.oracle.kind, reg.session],
        );
      }
      return;
    }
    case "Trade": {
      const c = await symbolForCommodity(client, ev.commodity);
      if (!c) return log.warn({ sig, commodity: ev.commodity }, "Trade for unknown commodity; skipped");
      const ins = await client.query(
        `insert into commodity_trades (sig, commodity, ts, side, usdc, coin, price, spread_bps, trader)
         values ($1,$2,to_timestamp($3),$4,$5::numeric,$6::numeric,$7::numeric,$8,$9) on conflict do nothing`,
        [sig, c.symbol, ts, ev.side, baseToHuman(ev.usdc), baseToHuman(ev.coin), price1e8ToHuman(ev.price), ev.spreadBps, ev.user],
      );
      if (ins.rowCount === 1) {
        const sign = ev.side === 0 ? "+" : "-";
        await client.query(
          `update commodities set supply_outstanding = greatest(0, supply_outstanding ${sign} $2::numeric),
                                  reserve_balance    = greatest(0, reserve_balance ${sign} $3::numeric)
           where symbol = $1`,
          [c.symbol, baseToHuman(ev.coin), baseToHuman(ev.usdc)],
        );
      }
      return;
    }
    case "PriceUpdated": {
      const c = await symbolForCommodity(client, ev.commodity);
      if (!c) return;
      const source = c.oracleKind === 1 ? "switchboard" : "keeper";
      await client.query(
        `insert into prices (commodity, ts, price, conf, source) values ($1, to_timestamp($2), $3::numeric, $4::numeric, $5)
         on conflict (commodity, ts, source) do nothing`,
        [c.symbol, ev.publishTime.toString(), price1e8ToHuman(ev.price), price1e8ToHuman(ev.conf), source],
      );
      await client.query(
        `update commodities set last_price_usd = $2::numeric, last_publish_time = to_timestamp($3)
         where symbol = $1 and (last_publish_time is null or last_publish_time <= to_timestamp($3))`,
        [c.symbol, price1e8ToHuman(ev.price), ev.publishTime.toString()],
      );
      return;
    }
    case "StatusChanged": {
      await client.query(`update commodities set status = $2 where commodity_pubkey = $1`, [ev.commodity, STATUS_TEXT[ev.status] ?? "halted"]);
      return;
    }

    // ---- fee_router ----
    case "PoolRegistered": {
      const c = await symbolForCommodity(client, ev.commodity);
      if (!c) return log.warn({ sig, commodity: ev.commodity }, "PoolRegistered for unknown commodity (seed SQL loaded?); skipped");
      const meta = await fetchTokenMetadata(deps.connection, ev.baseMint);
      const placeholder = ev.baseMint.slice(0, 6);
      await client.query(
        `insert into pools (dbc_pool, base_mint, quote_mint, commodity, creator, fee_bps, ticker, name, image_uri, created_at,
                            base_vault, quote_vault, registered_sig)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10),$11,$12,$13)
         on conflict (dbc_pool) do update set
           base_mint = excluded.base_mint, quote_mint = excluded.quote_mint, commodity = excluded.commodity,
           fee_bps = excluded.fee_bps, base_vault = excluded.base_vault, quote_vault = excluded.quote_vault,
           registered_sig = coalesce(pools.registered_sig, excluded.registered_sig),
           ticker    = case when $14 then excluded.ticker    else pools.ticker end,
           name      = case when $14 then excluded.name      else pools.name end,
           image_uri = coalesce(pools.image_uri, excluded.image_uri)`,
        [
          ev.pool, ev.baseMint, ev.quoteMint, c.symbol, tx.feePayer || ev.pool, ev.feeBps,
          meta?.symbol || placeholder, meta?.name || placeholder, meta?.uri || null, ts,
          dbcTokenVault(ev.baseMint, ev.pool), dbcTokenVault(ev.quoteMint, ev.pool), sig, meta !== null,
        ],
      );
      return;
    }
    case "FeesClaimed": {
      if (!(await poolExists(client, ev.pool))) return log.warn({ sig, pool: ev.pool }, "FeesClaimed for unknown pool; skipped");
      await client.query(
        `insert into fee_claims (pool, source, quote_amount, base_amount, ts, sig) values ($1,$2,$3::numeric,$4::numeric,to_timestamp($5),$6)
         on conflict (sig, pool, source) do nothing`,
        [ev.pool, ev.source, baseToHuman(ev.quoteAmount), baseToHuman(ev.baseAmount), ts, sig],
      );
      return;
    }
    case "FeesSplit": {
      if (!(await poolExists(client, ev.pool))) return;
      await client.query(
        `insert into fee_splits (sig, pool, holders, buyback, protocol, ts) values ($1,$2,$3::numeric,$4::numeric,$5::numeric,to_timestamp($6))
         on conflict do nothing`,
        [sig, ev.pool, baseToHuman(ev.holders), baseToHuman(ev.buyback), baseToHuman(ev.protocol), ts],
      );
      return;
    }
    case "MigrationRecorded": {
      const p = await poolExists(client, ev.pool);
      if (!p) return log.warn({ sig, pool: ev.pool }, "MigrationRecorded for unknown pool; skipped");
      await client.query(
        `update pools set migrated_at = coalesce(migrated_at, to_timestamp($3)), damm_pool = $2,
                          damm_base_vault = $4, damm_quote_vault = $5
         where dbc_pool = $1`,
        [ev.pool, ev.dammPool, ts, dammTokenVault(p.baseMint, ev.dammPool), dammTokenVault(p.quoteMint, ev.dammPool)],
      );
      return;
    }

    // ---- distributor ----
    case "EpochOpened": {
      const p = await poolExists(client, ev.pool);
      if (!p) return log.warn({ sig, pool: ev.pool }, "EpochOpened for unknown pool; skipped");
      // start/end are not in the event; the keeper's insertEpoch overwrites them (same PK).
      await client.query(
        `insert into epochs (pool, index, coin_mint, start_ts, end_ts, total_amount, eligible_holders, epoch_pubkey)
         values ($1,$2,$3,to_timestamp($4),to_timestamp($4),$5::numeric,$6,$7)
         on conflict (pool, index) do update set total_amount = excluded.total_amount,
           eligible_holders = excluded.eligible_holders, epoch_pubkey = coalesce(epochs.epoch_pubkey, excluded.epoch_pubkey)`,
        [ev.pool, ev.index, p.quoteMint, ts, baseToHuman(ev.total), ev.holders, epochPda(ev.pool, ev.index)],
      );
      return;
    }
    case "Payout": {
      if (!(await poolExists(client, ev.pool))) return;
      const index = await epochIndexFor(client, ev.pool, ev.epoch);
      if (index === null) return log.warn({ sig, epoch: ev.epoch }, "Payout for an epoch PDA we cannot map to an index; skipped");
      const ins = await client.query(
        `insert into payouts (pool, epoch, wallet, coin_mint, amount, kind, ts, sig) values ($1,$2,$3,$4,$5::numeric,$6,to_timestamp($7),$8)
         on conflict (pool, epoch, wallet, kind) do nothing`,
        [ev.pool, index, ev.wallet, ev.coinMint, baseToHuman(ev.amount), ev.payoutKind, ts, sig],
      );
      if (ins.rowCount !== 1) return;
      if (ev.payoutKind === 1) {
        await client.query(`update merkle_leaves set claimed = true where epoch_pubkey = $1 and wallet = $2`, [ev.epoch, ev.wallet]);
        await client.query(`update epochs set claimed_amount = claimed_amount + $3::numeric where pool = $1 and index = $2`, [ev.pool, index, baseToHuman(ev.amount)]);
      } else {
        await client.query(`update epochs set pushed_amount = pushed_amount + $3::numeric where pool = $1 and index = $2 and not finalized`, [
          ev.pool,
          index,
          baseToHuman(ev.amount),
        ]);
      }
      return;
    }
    case "EpochFinalized": {
      await client.query(
        `update epochs set finalized = true, merkle_root = $3, pushed_amount = greatest(0, total_amount - $4::numeric)
         where pool = $1 and index = $2`,
        [ev.pool, ev.index, ev.merkleRoot, baseToHuman(ev.remainder)],
      );
      return;
    }

    // ---- buyback ----
    case "Buyback": {
      await client.query(
        `insert into buybacks (coin_mint, coin_amount, gld_amount, ice_burned, ts, sig) values ($1,$2::numeric,$3::numeric,$4::numeric,to_timestamp($5),$6)
         on conflict (sig) do nothing`,
        [ev.coin, baseToHuman(ev.coinAmount), baseToHuman(ev.gldAmount), baseToHuman(ev.iceBurned), ts, sig],
      );
      return;
    }
  }
}

// ---- swaps & balances --------------------------------------------------------------------------

async function writeSwaps(tx: NormalizedTx, pools: PoolRef[], deps: IngestDeps): Promise<number> {
  const swaps = decodeSwaps(tx, pools);
  let n = 0;
  for (let i = 0; i < swaps.length; i++) {
    const s = swaps[i];
    if (s.base === 0n) continue;
    // trades.sig is the PK: suffix the (rare) 2nd+ pool swapped in the same transaction.
    const key = i === 0 ? tx.signature : `${tx.signature}:${i}`;
    const r = await deps.client.query(
      `insert into trades (sig, pool, ts, side, base, quote, price_quote, price_usd, trader)
       select $1, p.dbc_pool, to_timestamp($3), $4, $5::numeric / 1e6, $6::numeric / 1e6,
              round($6::numeric / $5::numeric, 18),
              round($6::numeric / $5::numeric * coalesce(
                (select pr.price from prices pr where pr.commodity = p.commodity and pr.ts <= to_timestamp($3) order by pr.ts desc limit 1),
                c.last_price_usd, 0), 18),
              $7
       from pools p join commodities c on c.symbol = p.commodity
       where p.dbc_pool = $2
       on conflict (sig) do nothing`,
      [key, s.pool, tx.blockTime, s.side, s.base.toString(), s.quote.toString(), s.trader],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

async function writeBalanceDeltas(tx: NormalizedTx, pools: PoolRef[], deps: IngestDeps): Promise<number> {
  let n = 0;
  for (const d of decodeBalanceDeltas(tx, pools)) {
    const r = await deps.client.query(
      `insert into balance_events (pool, wallet, delta, slot, ts, sig) values ($1,$2,$3::numeric,$4,to_timestamp($5),$6)
       on conflict (pool, wallet, sig) do nothing`,
      [d.pool, d.wallet, baseToHuman(d.delta), tx.slot, tx.blockTime, tx.signature],
    );
    if (r.rowCount === 1) {
      n++;
      await deps.client.query(
        `insert into balances (pool, wallet, amount, updated_slot) values ($1,$2,$3::numeric,$4)
         on conflict (pool, wallet) do update set amount = balances.amount + excluded.amount,
           updated_slot = greatest(balances.updated_slot, excluded.updated_slot)`,
        [d.pool, d.wallet, baseToHuman(d.delta), tx.slot],
      );
    }
  }
  return n;
}
