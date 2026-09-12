#!/usr/bin/env tsx
/**
 * Devnet smoke test (nightly in CI, or by hand). Read-only unless SMOKE_TRADE=1.
 *
 * Checks, against deployments/<cluster>.json:
 *   1. the four programs are deployed and executable
 *   2. peg_desk GlobalConfig, fee_router RouterConfig, distributor DistConfig exist and are not paused
 *   3. every seeded commodity: account decodes, reserve vault exists, and its oracle reading is fresh
 *      (age ≤ max_age for the current status; Halted markets are reported, not failed)
 *   4. reserve ratio ≥ reserve_halt_bps for every commodity with supply
 *   5. registered pools (fee_router PoolState) decode and their holder vaults exist
 *   6. SMOKE_TRADE=1: a 1 USDC buy + full sell round-trip on SMOKE_SYMBOL (default BURGER) with
 *      ADMIN_KEYPAIR_PATH, asserting the round-trip loses no more than 2 × spread + 1 unit
 *
 * Exit code 1 on any failure; prints a one-line summary per check. Warnings (stale keeper-signed
 * coins, halted markets) do not fail the run unless SMOKE_STRICT=1.
 *
 * Env: RPC_URL, [SOLANA_CLUSTER=devnet], [IDL_DIR=target/idl], [PEG_DESK_PROGRAM_ID … from .env, else
 *      registry], [ADMIN_KEYPAIR_PATH + SMOKE_TRADE=1 + SMOKE_SYMBOL], [SMOKE_STRICT=1]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { PROGRAM_IDS, parseCluster, usdcMintFor } from "@icemarkets/registry";
import { PegDeskClient, askPrice, bidPrice, feeRouter as feeRouterPda, distributor as distributorPda } from "@icemarkets/sdk";

interface DeploymentFile {
  cluster: string;
  globalConfig: string;
  commodities: { symbol: string; commodityPda: string; coinMint: string; reserveVault: string }[];
}

const STATUS_NAME = ["Open", "Closed", "Halted"];
let failures = 0;
let warnings = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => {
  warnings++;
  console.log(`  ! ${msg}`);
};
const fail = (msg: string) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

async function main(): Promise<void> {
  const cluster = parseCluster(process.env.SOLANA_CLUSTER);
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const ids = {
    pegDesk: new PublicKey(process.env.PEG_DESK_PROGRAM_ID ?? PROGRAM_IDS.pegDesk),
    feeRouter: new PublicKey(process.env.FEE_ROUTER_PROGRAM_ID ?? PROGRAM_IDS.feeRouter),
    distributor: new PublicKey(process.env.DISTRIBUTOR_PROGRAM_ID ?? PROGRAM_IDS.distributor),
    buyback: new PublicKey(process.env.BUYBACK_PROGRAM_ID ?? PROGRAM_IDS.buyback),
  };
  const depFile = path.join(process.cwd(), "deployments", `${cluster}.json`);
  if (!existsSync(depFile)) throw new Error(`no ${depFile}`);
  const dep = JSON.parse(readFileSync(depFile, "utf8")) as DeploymentFile;

  // A read-only wallet is fine for everything except SMOKE_TRADE.
  const wallet = process.env.ADMIN_KEYPAIR_PATH
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR_PATH, "utf8"))))
    : Keypair.generate();
  const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
  const withAddress = (idl: any, address: PublicKey) => ({ ...idl, address: address.toBase58() });
  const pegDesk = new PegDeskClient(provider, loadIdl("peg_desk"), ids.pegDesk);
  const feeRouter = new Program(withAddress(loadIdl("fee_router"), ids.feeRouter), provider) as any;
  const distributor = new Program(withAddress(loadIdl("distributor"), ids.distributor), provider) as any;

  console.log(`devnet smoke — ${cluster} via ${connection.rpcEndpoint}`);

  // 1. programs
  console.log("programs");
  for (const [name, id] of Object.entries(ids)) {
    const info = await connection.getAccountInfo(id);
    if (info?.executable) ok(`${name} ${id.toBase58()}`);
    else fail(`${name} ${id.toBase58()} not deployed`);
  }

  // 2. configs
  console.log("configs");
  const cfg = await (pegDesk.program.account as any).globalConfig.fetchNullable(pegDesk.configPda());
  if (!cfg) fail("peg_desk GlobalConfig missing");
  else if (cfg.globalPause) fail("peg_desk is globally paused");
  else ok(`peg_desk GlobalConfig (${cfg.keeperCount} keepers, halt ${cfg.reserveHaltBps} bps)`);
  const router = await feeRouter.account.routerConfig.fetchNullable(feeRouterPda.router(ids.feeRouter)[0]);
  if (!router) fail("fee_router RouterConfig missing (make init-programs)");
  else if (router.paused) fail("fee_router is paused");
  else if (router.holdersBps + router.buybackBps + router.protocolBps !== 10_000) fail("fee_router split does not sum to 10000");
  else ok(`fee_router RouterConfig (${router.holdersBps}/${router.buybackBps}/${router.protocolBps}, ${router.keeperCount} keepers)`);
  const dist = await distributor.account.distConfig.fetchNullable(distributorPda.config(ids.distributor)[0]);
  if (!dist) fail("distributor DistConfig missing (make init-programs)");
  else ok("distributor DistConfig");

  // 3 + 4. commodities
  console.log(`commodities (${dep.commodities.length})`);
  const now = Math.floor(Date.now() / 1000);
  let fresh = 0;
  for (const c of dep.commodities) {
    try {
      const view = await pegDesk.fetchCommodityView(c.symbol);
      if (!view.coinMint.equals(new PublicKey(c.coinMint))) {
        fail(`${c.symbol}: coin mint drifted from deployments file`);
        continue;
      }
      const vault = await getAccount(connection, view.reserveVault);
      const status = STATUS_NAME[view.status] ?? `status ${view.status}`;
      if (view.status === 2) {
        warn(`${c.symbol}: Halted`);
        continue;
      }
      let reading;
      try {
        reading = await pegDesk.fetchOracleReading(view);
      } catch (e) {
        fail(`${c.symbol}: oracle unreadable (${String(e).split("\n")[0]})`);
        continue;
      }
      const maxAge = Number(view.status === 0 ? view.maxAgeOpenSec : view.maxAgeClosedSec);
      const age = now - Number(reading.publishTime);
      const price = Number(reading.price) / 1e8;
      const supply = view.supply;
      let ratioNote = "";
      if (supply > 0n) {
        const liability = (supply * reading.price) / 100_000_000n; // equal decimals
        const ratioBps = liability > 0n ? (vault.amount * 10_000n) / liability : 0n;
        ratioNote = ` reserve ${Number(ratioBps) / 100}%`;
        if (ratioBps < view.reserveHaltBps) fail(`${c.symbol}: reserve ratio ${Number(ratioBps) / 100}% < halt ${Number(view.reserveHaltBps) / 100}%`);
      }
      if (age > maxAge) {
        const msg = `${c.symbol}: ${status} but oracle is ${age}s old (max ${maxAge}s), $${price}`;
        if (view.oracleKind === 0 || process.env.SMOKE_STRICT === "1") fail(msg);
        else warn(msg);
      } else {
        fresh++;
        ok(`${c.symbol.padEnd(11)} ${status.padEnd(6)} $${price.toLocaleString("en-US", { maximumFractionDigits: 4 })} (${age}s old)${ratioNote}`);
      }
    } catch (e) {
      fail(`${c.symbol}: ${String(e).split("\n")[0]}`);
    }
  }
  console.log(`  ${fresh}/${dep.commodities.length} commodities fresh`);

  // 5. pools
  console.log("pools");
  const pools = await feeRouter.account.poolState.all();
  if (pools.length === 0) warn("no PoolState registered yet");
  for (const p of pools) {
    const ps = p.account;
    const [holderVault] = feeRouterPda.holderVault(ids.feeRouter, ps.dbcPool);
    try {
      const hv = await getAccount(connection, holderVault);
      ok(`pool ${ps.dbcPool.toBase58().slice(0, 8)}… quote ${ps.quoteMint.toBase58().slice(0, 8)}… ${ps.migrated ? "DAMM" : "DBC"} claimed ${ps.totalClaimed.toString()} holderVault ${hv.amount.toString()}`);
    } catch {
      fail(`pool ${ps.dbcPool.toBase58()}: holder vault missing`);
    }
  }

  // 6. optional round-trip
  if (process.env.SMOKE_TRADE === "1") {
    const symbol = process.env.SMOKE_SYMBOL ?? "BURGER";
    console.log(`trade round-trip on ${symbol}`);
    if (!process.env.ADMIN_KEYPAIR_PATH) fail("SMOKE_TRADE needs ADMIN_KEYPAIR_PATH");
    else {
      try {
        const usdcMint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT_OVERRIDE));
        const view = await pegDesk.fetchCommodityView(symbol);
        const reading = await pegDesk.fetchOracleReading(view);
        const userUsdc = getAssociatedTokenAddressSync(usdcMint, wallet.publicKey);
        const userCoin = getAssociatedTokenAddressSync(view.coinMint, wallet.publicKey);
        const usdcBefore = (await getAccount(connection, userUsdc)).amount;
        const coinBefore = await getAccount(connection, userCoin).then((a) => a.amount).catch(() => 0n);

        const usdcIn = 1_000_000n; // 1 USDC
        const spread = view.baseSpreadBps;
        const askP = askPrice(reading.price, spread);
        const minCoin = (((usdcIn * 100_000_000n) / askP) * 98n) / 100n;
        const buyIx = await pegDesk.buyIx({ user: wallet.publicKey, commodity: view, usdcIn, minCoinOut: minCoin, userUsdcAta: userUsdc });
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
            pegDesk.createUserCoinAtaIx(wallet.publicKey, wallet.publicKey, view.coinMint),
            buyIx,
          ),
          [wallet],
        );
        const coinAfterBuy = (await getAccount(connection, userCoin)).amount;
        const got = coinAfterBuy - coinBefore;
        ok(`buy 1 USDC → ${Number(got) / 1e6} ${symbol}`);

        const bidP = bidPrice(reading.price, spread);
        const minUsdc = (((got * bidP) / 100_000_000n) * 98n) / 100n;
        const sellIx = await pegDesk.sellIx({ user: wallet.publicKey, commodity: view, coinIn: got, minUsdcOut: minUsdc, userUsdcAta: userUsdc });
        await sendAndConfirmTransaction(connection, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), sellIx), [wallet]);
        const usdcAfter = (await getAccount(connection, userUsdc)).amount;
        const lost = usdcBefore - usdcAfter;
        const maxLoss = (usdcIn * 2n * spread) / 10_000n + 1n;
        if (lost <= maxLoss) ok(`sell back → round-trip cost ${Number(lost) / 1e6} USDC (≤ ${Number(maxLoss) / 1e6})`);
        else fail(`round-trip cost ${Number(lost) / 1e6} USDC exceeds 2 × spread`);
      } catch (e) {
        fail(`round-trip: ${String(e).split("\n")[0]}`);
      }
    }
  }

  console.log(`\n${failures} failure(s), ${warnings} warning(s)`);
  if (failures > 0 || (warnings > 0 && process.env.SMOKE_STRICT === "1")) process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadIdl(name: string): any {
  const file = path.join(process.env.IDL_DIR ?? path.join(process.cwd(), "target", "idl"), `${name}.json`);
  if (!existsSync(file)) throw new Error(`IDL not found at ${file} — run \`anchor build\` first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
