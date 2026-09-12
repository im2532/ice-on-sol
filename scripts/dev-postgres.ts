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
  // Create the database named in DATABASE_URL if it does not exist yet (one server, one db per cluster:
  // e.g. icemarkets for devnet, icemarkets_local for localnet).
  // RESET_DB=1 drops it first (localnet ledgers are ephemeral; stale pool/mint rows would confuse the keeper).
  if (process.env.RESET_DB === "1") {
    try {
      await pg.dropDatabase(dbName);
      console.log(`dropped database ${dbName} (RESET_DB=1)`);
    } catch (err) {
      if (!/does not exist/.test(String(err))) throw err;
    }
  }
  try {
    await pg.createDatabase(dbName);
  } catch (err) {
    if (!/already exists/.test(String(err))) throw err;
  }
  console.log(`postgres up: ${user}@localhost:${port}/${dbName} (data: ${dataDir})`);

  const client = pg.getPgClient(dbName);
  await client.connect();
  await client.query(readFileSync(path.resolve("apps/indexer/schema.sql"), "utf8"));
  const seedFile = path.resolve("deployments", `${cluster}.sql`);
  // The seed SQL is idempotent (insert ... on conflict do update), so re-apply it on every start to pick
  // up commodities seeded since the last run.
  if (existsSync(seedFile)) {
    await client.query(readFileSync(seedFile, "utf8"));
    const after = await client.query("select count(*)::int as n from commodities");
    console.log(`applied ${path.basename(seedFile)}: ${after.rows[0].n} commodities`);
  } else {
    console.log(`no ${path.basename(seedFile)} to load`);
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
