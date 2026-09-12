#!/usr/bin/env tsx
/**
 * Buy a launched memecoin with USDC from the command line (peg_desk.buy USDC→COIN, then dbc.swap COIN→MEME),
 * the same `buildBuyWithUsdc` path the web uses — for generating volume/fees on localnet/devnet.
 *
 *   pnpm exec tsx scripts/trade-market.ts --pool <dbcPool> [--usdc 100] [--count 1] [--slippage 300]
 *
 * Env: RPC_URL, SOLANA_CLUSTER, ADMIN_KEYPAIR_PATH (trader; must hold USDC), USDC_MINT_OVERRIDE on localnet,
 * [IDL_DIR]. The pool must be in deployments/<cluster>.json#markets (written by scripts/launch-market.ts) or
 * pass --quote <SYMBOL> --mint <memeMint> explicitly.
 */
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as sdk from "@icemarkets/sdk";
import { usdcMintFor, parseCluster } from "@icemarkets/registry";

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`missing --${name}`);
}
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const cluster = parseCluster(process.env.SOLANA_CLUSTER);
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const trader = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(requireEnv("ADMIN_KEYPAIR_PATH"), "utf8"))));
  const dbcPool = new PublicKey(arg("pool"));
  const usdcHuman = Number(arg("usdc", "100"));
  const count = Number(arg("count", "1"));
  const slippageBps = Number(arg("slippage", "300"));

  const depFile = path.join(process.cwd(), "deployments", `${cluster}.json`);
  const dep = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : {};
  const market = (dep.markets ?? []).find((m: { dbcPool: string }) => m.dbcPool === dbcPool.toBase58());
  const quote = arg("quote", market?.quote);
  const memeMint = new PublicKey(arg("mint", market?.baseMint));
  if (!quote) throw new Error("pool not in deployments file; pass --quote and --mint");

  const usdcMint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT_OVERRIDE));
  const idlDir = process.env.IDL_DIR ?? path.join(process.cwd(), "target", "idl");
  const idl = JSON.parse(readFileSync(path.join(idlDir, "peg_desk.json"), "utf8"));
  const pegDesk = sdk.createPegDeskClient(connection, trader.publicKey, idl);
  const commodity = await pegDesk.fetchCommodityView(quote);

  for (let i = 0; i < count; i++) {
    const oracle = await pegDesk.fetchOracleReading(commodity);
    const built = await sdk.buildBuyWithUsdc({
      connection, user: trader.publicKey, commodity, oracle, dbcPool, memeMint,
      usdcIn: BigInt(Math.round(usdcHuman * 1e6)), userUsdcAta: sdk.ata(usdcMint, trader.publicKey), slippageBps, pegDesk,
    });
    const tx = new Transaction().add(...built.instructions);
    tx.feePayer = trader.publicKey;
    const bh = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.sign(trader);
    const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) throw new Error(`buy ${i + 1}/${count} failed: ${JSON.stringify(conf.value.err)} (${sig})`);
    console.log(`buy ${i + 1}/${count}: $${usdcHuman} USDC -> ${quote} -> MEME (min ${built.minOut} ${quote} base units)  ${sig}`);
  }
  const memeBal = await connection.getTokenAccountBalance(sdk.ata(memeMint, trader.publicKey)).catch(() => null);
  console.log(`trader MEME balance: ${memeBal?.value.uiAmountString ?? "n/a"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
