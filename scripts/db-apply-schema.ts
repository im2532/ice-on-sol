#!/usr/bin/env tsx
/**
 * Apply apps/indexer/schema.sql to DATABASE_URL (idempotent: the schema uses `create ... if not exists`).
 * For machines without psql, and for Fly release commands. Optionally loads deployments/<cluster>.sql when
 * SEED_SQL=1 (upserts; safe to re-run).
 *   set -a; . ./.env.mainnet; set +a; pnpm exec tsx scripts/db-apply-schema.ts
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).host;
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(readFileSync(path.resolve("apps/indexer/schema.sql"), "utf8"));
  const tables = await client.query("select count(*)::int as n from information_schema.tables where table_schema='public'");
  console.log(`schema applied on ${host}: ${tables.rows[0].n} public tables`);
  if (process.env.SEED_SQL === "1") {
    const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
    const f = path.resolve("deployments", `${cluster}.sql`);
    if (existsSync(f)) {
      await client.query(readFileSync(f, "utf8"));
      const n = await client.query("select count(*)::int as n from commodities");
      console.log(`loaded ${path.basename(f)}: ${n.rows[0].n} commodities`);
    } else console.log(`no ${path.basename(f)} to load`);
  }
  await client.end();
}
main().catch((err) => { console.error(String(err).replace(/npg_[A-Za-z0-9]+/g, "npg_***")); process.exit(1); });
