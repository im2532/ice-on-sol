#!/usr/bin/env tsx
/**
 * Dev-only Postgres for the keeper/indexer when no system Postgres is installed: runs an embedded
 * server (npm `embedded-postgres`) in ./.pgdata matching DATABASE_URL's user/password/port/db, applies
 * apps/indexer/schema.sql, and loads deployments/<SOLANA_CLUSTER>.sql the first time the commodities
 * table is empty. Keeps running until Ctrl-C (`make db`).
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const url = new URL(process.env.DATABASE_URL ?? "postgres://icemarkets:icemarkets@localhost:5432/icemarkets");
const user = decodeURIComponent(url.username || "icemarkets");
const password = decodeURIComponent(url.password || "icemarkets");
const port = Number(url.port || 5432);
const dbName = url.pathname.replace(/^\//, "") || "icemarkets";
const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
const dataDir = path.resolve(process.cwd(), ".pgdata");

async function main(): Promise<void> {
  const fresh = !existsSync(dataDir);
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user, password, port, persistent: true });
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase(dbName);
  console.log(`postgres up: ${user}@localhost:${port}/${dbName} (data: ${dataDir})`);

  const client = pg.getPgClient(dbName);
  await client.connect();
  await client.query(readFileSync(path.resolve("apps/indexer/schema.sql"), "utf8"));
  const seedFile = path.resolve("deployments", `${cluster}.sql`);
  const { rows } = await client.query("select count(*)::int as n from commodities");
  if (rows[0].n === 0 && existsSync(seedFile)) {
    await client.query(readFileSync(seedFile, "utf8"));
    const after = await client.query("select count(*)::int as n from commodities");
    console.log(`applied ${path.basename(seedFile)}: ${after.rows[0].n} commodities`);
  } else {
    console.log(`commodities table has ${rows[0].n} rows${rows[0].n === 0 ? ` (no ${path.basename(seedFile)} to load)` : ""}`);
  }
  await client.end();

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log("ready; Ctrl-C to stop");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
