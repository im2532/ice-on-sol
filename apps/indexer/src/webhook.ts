import Fastify from "fastify";
import { pool, query } from "./db";
import { defaultConnection, ingestTransaction, type IngestLogger } from "./decode/ingest";
import { missingIdls } from "./decode/anchorEvents";
import { fromHeliusEnhanced, fromRawRpc, isHeliusEnhanced, isRawRpc } from "./decode/normalize";
import type { NormalizedTx } from "./decode/types";

/**
 * Helius webhook receiver (`POST /helius`). Accepts both delivery types:
 *  - "enhanced": `accountData[].tokenBalanceChanges` / `tokenTransfers` drive the DBC / DAMM v2 swap and
 *    balance decoders; Anchor events need program logs, which enhanced payloads do not carry, so for
 *    transactions that invoked an ICEmarkets program the logs are fetched with `getTransaction` (RPC_URL).
 *  - "raw": RPC-shaped transactions with `meta.logMessages` and pre/post token balances — no extra RPC.
 * Watch the four ICEmarkets program ids, the DBC and DAMM v2 programs, and every registered memecoin
 * mint (so wallet-to-wallet transfers reach `balance_events`; see README "Helius setup").
 *
 * Decoding / table mapping lives in src/decode/* (shared with src/backfill.ts). Rollups (candles, 24h
 * volume, curve %) stay in candles.ts / the keeper.
 */

const PORT = Number(process.env.WEBHOOK_PORT ?? 4001);
const HELIUS_AUTH_HEADER = process.env.HELIUS_WEBHOOK_AUTH_HEADER ?? ""; // shared secret Helius echoes back

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });
const log: IngestLogger = {
  info: (o, m) => app.log.info(o, m),
  warn: (o, m) => app.log.warn(o, m),
  error: (o, m) => app.log.error(o, m),
  debug: (o, m) => app.log.debug(o, m),
};

function normalize(item: unknown): NormalizedTx | null {
  if (isRawRpc(item)) return fromRawRpc(item);
  if (isHeliusEnhanced(item)) return fromHeliusEnhanced(item);
  return null;
}

app.post("/helius", async (req, reply) => {
  if (HELIUS_AUTH_HEADER && req.headers["authorization"] !== HELIUS_AUTH_HEADER) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  const body: unknown = req.body;
  if (!Array.isArray(body)) return reply.code(400).send({ error: "expected an array of transactions" });

  const connection = defaultConnection();
  const client = await pool.connect();
  const totals = { txs: 0, events: 0, trades: 0, balanceEvents: 0, errors: 0, skipped: 0 };
  let last: NormalizedTx | null = null;
  try {
    await client.query("begin");
    for (const item of body as unknown[]) {
      const tx = normalize(item);
      if (!tx) {
        totals.skipped++;
        continue;
      }
      const r = await ingestTransaction(tx, { client, connection, log }, item);
      totals.txs++;
      totals.events += r.events;
      totals.trades += r.trades;
      totals.balanceEvents += r.balanceEvents;
      if (r.error) totals.errors++;
      last = tx;
    }
    if (last) {
      await client.query(
        `insert into ingest_cursor (source, last_sig, last_slot, updated_at)
         values ('helius_webhook', $1, $2, now())
         on conflict (source) do update set last_sig = excluded.last_sig, last_slot = excluded.last_slot, updated_at = now()`,
        [last.signature, last.slot],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    app.log.error({ err: String(err) }, "ingest batch failed");
    return reply.code(500).send({ error: "ingest failed" });
  } finally {
    client.release();
  }

  return { ok: true, processed: body.length, ...totals };
});

app.get("/healthz", async () => {
  const cursor = await query<{ last_sig: string | null; last_slot: string | null; updated_at: Date }>(
    `select last_sig, last_slot, updated_at from ingest_cursor where source = 'helius_webhook'`,
  );
  return { ok: true, missingIdls: missingIdls(), cursor: cursor[0] ?? null };
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`webhook receiver listening on :${PORT}`);
    const missing = missingIdls();
    if (missing.length > 0) app.log.warn({ missing }, "IDLs missing (run `anchor build` or set IDL_DIR) — events of these programs are not decoded");
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
