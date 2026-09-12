#!/usr/bin/env tsx
/**
 * Backfill one registered pool from RPC history (getSignaturesForAddress + getParsedTransactions),
 * through the same decoders as the webhook (src/decode/*). Idempotent — re-running is a no-op for rows
 * already ingested, so it is safe to overlap with the live webhook.
 *
 * Addresses scanned (oldest → newest, de-duplicated by signature):
 *   dbc_pool, damm_pool (if migrated), the memecoin mint (transfers), fee_router PoolState + holder_vault
 *   (register / claims / open_epoch), and distributor Epoch PDAs 0..max(known)+1 (push / claim / finalize).
 *
 * Usage:
 *   pnpm --filter @icemarkets/indexer backfill -- <dbc_pool> [--limit 5000] [--resume] [--address <extra>…]
 *   (`--resume` stops, per scanned address, at the newest signature a previous COMPLETED run recorded in
 *    ingest_cursor 'backfill:<address>'; an interrupted run simply re-ingests — every write is idempotent.)
 * Env: DATABASE_URL, RPC_URL (or HELIUS_API_KEY), [IDL_DIR], program ids as in .env.example.
 */
import { Connection, PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { pool as pgPool } from "./db";
import { defaultConnection, epochPda, ingestTransaction, reconcilePools, type IngestLogger } from "./decode/ingest";
import { programIds } from "./decode/anchorEvents";
import { fromParsedRpc } from "./decode/normalize";

const PAGE = 1000; // getSignaturesForAddress max
const TX_BATCH = 25; // getParsedTransactions batch (keep well under provider rate limits)

const log: IngestLogger = {
  info: (o, m) => console.log(m ?? "", JSON.stringify(o)),
  warn: (o, m) => console.warn(m ?? "", JSON.stringify(o)),
  error: (o, m) => console.error(m ?? "", JSON.stringify(o)),
  debug: () => {},
};

interface Args {
  dbcPool: string;
  limit: number;
  resume: boolean;
  extra: string[];
}

function parseArgs(argv: string[]): Args {
  const rest = argv.filter((a) => a !== "--");
  const positional: string[] = [];
  const extra: string[] = [];
  let limit = 5000;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--limit") limit = Number(rest[++i]);
    else if (a === "--address") extra.push(new PublicKey(rest[++i]).toBase58());
    else if (!a.startsWith("--")) positional.push(a);
  }
  const dbcPool = positional[0];
  if (!dbcPool || !Number.isFinite(limit) || limit <= 0) throw new Error("usage: backfill.ts <dbc_pool> [--limit N] [--resume] [--address <addr>]");
  new PublicKey(dbcPool); // validate
  return { dbcPool, limit, resume: rest.includes("--resume"), extra };
}

async function addressesFor(dbcPool: string, extra: string[]): Promise<string[]> {
  const ids = programIds();
  const fr = new PublicKey(ids.fee_router);
  const poolKey = new PublicKey(dbcPool);
  const out = new Set<string>([dbcPool, ...extra]);
  out.add(PublicKey.findProgramAddressSync([Buffer.from("pool"), poolKey.toBuffer()], fr)[0].toBase58()); // PoolState
  out.add(PublicKey.findProgramAddressSync([Buffer.from("holder_vault"), poolKey.toBuffer()], fr)[0].toBase58());

  const row = await pgPool.query<{ base_mint: string; damm_pool: string | null }>(`select base_mint, damm_pool from pools where dbc_pool = $1`, [dbcPool]);
  if (row.rows[0]) {
    out.add(row.rows[0].base_mint);
    if (row.rows[0].damm_pool) out.add(row.rows[0].damm_pool);
  }
  const maxEpoch = await pgPool.query<{ max: number | null }>(`select max(index) as max from epochs where pool = $1`, [dbcPool]);
  const upper = (maxEpoch.rows[0]?.max ?? -1) + 1;
  for (let i = 0; i <= upper; i++) out.add(epochPda(dbcPool, i));
  return [...out];
}

async function signaturesFor(conn: Connection, address: string, until: string | undefined, limit: number): Promise<ConfirmedSignatureInfo[]> {
  const out: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  while (out.length < limit) {
    const page = await conn.getSignaturesForAddress(new PublicKey(address), { before, until, limit: Math.min(PAGE, limit - out.length) }, "confirmed");
    if (page.length === 0) break;
    out.push(...page);
    before = page[page.length - 1].signature;
    if (page.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const conn = defaultConnection();
  {
    // Pools whose PoolRegistered event was lost (log truncation) are recovered from fee_router PoolState first.
    const c0 = await pgPool.connect();
    try {
      const added = await reconcilePools({ client: c0, connection: conn, log });
      if (added > 0) log.info({ added }, "pools reconciled from PoolState");
    } finally {
      c0.release();
    }
  }
  if (!conn) throw new Error("RPC_URL (or HELIUS_API_KEY) is required for the backfill");
  const addresses = await addressesFor(args.dbcPool, args.extra);
  console.log(`backfill ${args.dbcPool}: scanning ${addresses.length} addresses${args.resume ? " (resume)" : ""}`);

  // Merge signature lists; RPC returns newest-first, so reverse each list and order by slot ascending.
  const bySig = new Map<string, { slot: number; order: number }>();
  const newestByAddress = new Map<string, ConfirmedSignatureInfo>();
  let order = 0;
  for (const address of addresses) {
    const until = args.resume
      ? (await pgPool.query<{ last_sig: string | null }>(`select last_sig from ingest_cursor where source = $1`, [`backfill:${address}`])).rows[0]?.last_sig ?? undefined
      : undefined;
    const newestFirst = await signaturesFor(conn, address, until, args.limit);
    if (newestFirst[0]) newestByAddress.set(address, newestFirst[0]);
    for (const s of newestFirst.reverse()) if (!s.err && !bySig.has(s.signature)) bySig.set(s.signature, { slot: s.slot, order: order++ });
  }
  const ordered = [...bySig.entries()].sort((a, b) => a[1].slot - b[1].slot || a[1].order - b[1].order).map(([sig]) => sig);
  console.log(`backfill: ${ordered.length} transactions to ingest`);

  const totals = { txs: 0, events: 0, trades: 0, balanceEvents: 0, errors: 0 };
  for (let i = 0; i < ordered.length; i += TX_BATCH) {
    const batch = ordered.slice(i, i + TX_BATCH);
    // CHECK: web3.js ParsedTransactionWithMeta is structurally a ParsedRpcTx (accountKeys[].pubkey: PublicKey,
    // instructions[].programId: PublicKey, meta.pre/postTokenBalances) — see decode/types.ts.
    const txs = await conn.getParsedTransactions(batch, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const client = await pgPool.connect();
    try {
      await client.query("begin");
      for (let j = 0; j < txs.length; j++) {
        const parsed = txs[j];
        if (!parsed) {
          log.warn({ sig: batch[j] }, "transaction not found (pruned?)");
          continue;
        }
        const tx = fromParsedRpc(parsed);
        const r = await ingestTransaction(tx, { client, connection: conn, log });
        totals.txs++;
        totals.events += r.events;
        totals.trades += r.trades;
        totals.balanceEvents += r.balanceEvents;
        if (r.error) totals.errors++;
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    console.log(`  ${Math.min(i + TX_BATCH, ordered.length)}/${ordered.length}`, JSON.stringify(totals));
  }
  // Per-address cursors are only advanced after a complete run.
  for (const [address, sig] of newestByAddress) {
    await pgPool.query(
      `insert into ingest_cursor (source, last_sig, last_slot, updated_at) values ($1, $2, $3, now())
       on conflict (source) do update set last_sig = excluded.last_sig, last_slot = excluded.last_slot, updated_at = now()`,
      [`backfill:${address}`, sig.signature, sig.slot],
    );
  }
  console.log("backfill done", JSON.stringify(totals));
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pgPool.end());
