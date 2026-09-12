#!/usr/bin/env tsx
/**
 * Launch a market from the command line with a local keypair (no browser wallet) — the same
 * `buildLaunchTransactions` path the web uses, for localnet/devnet loop testing.
 *
 *   pnpm exec tsx scripts/launch-market.ts --quote BURGER --name "Big Mac Enjoyer" --symbol BIGMAC [--fee 200] [--buy 1] [--price 5.91]
 *
 * Env: RPC_URL, SOLANA_CLUSTER, ADMIN_KEYPAIR_PATH (creator + payer; must hold USDC), USDC_MINT_OVERRIDE on
 * localnet, [IDL_DIR]. Reads deployments/<cluster>.json for the launch ALT. Prints the pool + mint and
 * appends them to deployments/<cluster>.json under `markets`.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as sdk from "@icemarkets/sdk";
import { LAUNCH, usdcMintFor, parseCluster } from "@icemarkets/registry";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const cluster = parseCluster(process.env.SOLANA_CLUSTER);
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(requireEnv("ADMIN_KEYPAIR_PATH"), "utf8"))));
  const quote = arg("quote");
  const name = arg("name");
  const symbol = arg("symbol");
  const feeTierBps = Number(arg("fee", "200")) as (typeof LAUNCH.feeTiersBps)[number];
  const firstBuyUsdc = Number(arg("buy", "1"));
  const usdcMint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT_OVERRIDE));
  const idlDir = process.env.IDL_DIR ?? path.join(process.cwd(), "target", "idl");
  const idl = JSON.parse(readFileSync(path.join(idlDir, "peg_desk.json"), "utf8"));
  const pegDesk = sdk.createPegDeskClient(connection, creator.publicKey, idl);
  const commodity = await pegDesk.fetchCommodityView(quote);

  // The quote coin's oracle must have a reading (keeper posts KeeperSigned prices on its first cycle).
  let oracle: Awaited<ReturnType<typeof pegDesk.fetchOracleReading>> | null = null;
  for (let i = 0; i < 24 && !oracle; i++) {
    try {
      oracle = await pegDesk.fetchOracleReading(commodity);
    } catch (err) {
      if (i === 23) throw err;
      console.log(`waiting for ${quote} oracle reading (${String(err).slice(0, 80)})…`);
      await sleep(10_000);
    }
  }
  const coinUsdPrice = Number(arg("price", (Number(oracle!.price) / 1e8).toString()));

  const depFile = path.join(process.cwd(), "deployments", `${cluster}.json`);
  const dep = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : {};
  const alt = await sdk.loadLaunchAlt(connection, dep.addressLookupTable ? new PublicKey(dep.addressLookupTable) : null);
  if (!alt) console.warn("no addressLookupTable in deployments file — the launch tx may exceed 1232 bytes (run scripts/create-alt.ts)");

  const res = await sdk.buildLaunchTransactions({
    connection, creator: creator.publicKey, commoditySymbol: quote, name, symbol, uri: "",
    feeTierBps, firstBuyUsdc, payWith: "USDC", commodity, oracle: oracle!, coinUsdPrice,
    usdcMint, wsolMint: new PublicKey("So11111111111111111111111111111111111111112"),
    userUsdcAta: sdk.ata(usdcMint, creator.publicKey), userCoinAta: sdk.ata(commodity.coinMint, creator.publicKey),
    treasury: sdk.feeRouter.router(sdk.FEE_ROUTER_PROGRAM_ID)[0], pegDesk, addressLookupTable: alt,
  });
  const sigs: string[] = [];
  for (const [i, tx] of res.transactions.entries()) {
    tx.sign([creator, ...res.signers[i]]);
    const sig = await connection.sendTransaction(tx, { maxRetries: 3 });
    const bh = await connection.getLatestBlockhash("confirmed");
    const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) throw new Error(`tx ${i + 1}/${res.transactions.length} failed: ${JSON.stringify(conf.value.err)} (${sig})`);
    console.log(`tx ${i + 1}/${res.transactions.length} ${sig}`);
    sigs.push(sig);
  }
  const baseMint = res.baseMintKeypair.publicKey;
  const dbcPool = sdk.deriveDbcPoolAddress(res.configKeypair.publicKey, baseMint, commodity.coinMint);
  const market = { symbol, name, quote, baseMint: baseMint.toBase58(), dbcConfig: res.configKeypair.publicKey.toBase58(), dbcPool: dbcPool.toBase58(), creator: creator.publicKey.toBase58(), launchedAt: new Date().toISOString(), signatures: sigs };
  console.log(JSON.stringify(market, null, 2));
  dep.markets = [...(dep.markets ?? []), market];
  writeFileSync(depFile, JSON.stringify(dep, null, 2));
  console.log(`recorded in deployments/${cluster}.json#markets`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
