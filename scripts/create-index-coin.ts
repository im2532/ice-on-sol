#!/usr/bin/env tsx
/**
 * Creates PMX (Precious Metals Index — the first `Composite` index coin, per
 * `@icemarkets/registry`'s `INDEX_COINS`) via `peg_desk.create_commodity` followed by
 * `set_index_legs`, wiring its four legs (GLD 40%, SLV 30%, XPT 15%, XPD 15%) to the
 * already-created leg commodities' PDAs.
 *
 * Prerequisite: `scripts/seed-commodities.ts` must have already created GLD, SLV, XPT and
 * XPD (they're `byPhase('mvp')`), since `set_index_legs` needs their `Commodity` PDAs as
 * remaining accounts (CONTRACTS §1: `set_index_legs | admin | commodity*, leg commodities
 * (remaining) | legs`).
 *
 * Usage: `pnpm exec tsx scripts/create-index-coin.ts [symbol]` (defaults to PMX; pass
 * CS2X once its v1.1 leg commodities exist).
 *
 * Caps: USD caps are converted to coin base units at the index's seed price = Σ weight × leg seed
 * price (from deployments/<cluster>.json, written by seed-commodities.ts), or `SEED_PRICE_<SYMBOL>`.
 * Needs `target/idl/peg_desk.json` (run `anchor build`). Env as seed-commodities.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import { INDEX_COINS, USDC } from "@icemarkets/registry";
import { PegDeskClient } from "@icemarkets/sdk";

const COIN_UNIT = 1_000_000n;
const PRICE_SCALE = 100_000_000n;

async function main(): Promise<void> {
  const symbol = process.argv[2] ?? "PMX";
  const index = INDEX_COINS.find((c) => c.symbol === symbol);
  if (!index) throw new Error(`create-index-coin: "${symbol}" not found in @icemarkets/registry INDEX_COINS`);
  const legs = index.oracle.legs ?? [];
  if (legs.length === 0) throw new Error(`create-index-coin: ${symbol} has no legs configured`);

  const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(requireEnv("ADMIN_KEYPAIR_PATH"), "utf8"))));
  const pegDeskProgramId = new PublicKey(requireEnv("PEG_DESK_PROGRAM_ID"));
  const usdcMint = new PublicKey(process.env.USDC_MINT ?? USDC[cluster as keyof typeof USDC] ?? USDC.devnet);
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const pegDesk = new PegDeskClient(provider, loadIdl("peg_desk"), pegDeskProgramId);

  const deployment = readDeployment(cluster);
  let price1e8: bigint;
  if (process.env[`SEED_PRICE_${symbol}`]) {
    price1e8 = BigInt(Math.round(Number(process.env[`SEED_PRICE_${symbol}`]) * 1e8));
  } else {
    let acc = 0;
    for (const leg of legs) {
      const found = deployment?.commodities.find((c) => c.symbol === leg.symbol);
      if (!found?.seedPriceUsd) throw new Error(`leg ${leg.symbol} missing from deployments/${cluster}.json — run seed-commodities.ts first (or set SEED_PRICE_${symbol})`);
      acc += (found.seedPriceUsd * leg.weightBps) / 10_000;
    }
    price1e8 = BigInt(Math.round(acc * 1e8));
  }
  const toBase = (usd: number) => (BigInt(Math.round(usd * 100)) * COIN_UNIT * PRICE_SCALE) / (100n * price1e8);

  console.log(`Creating index coin ${symbol} @ $${Number(price1e8) / 1e8} with ${legs.length} legs:`);
  for (const leg of legs) console.log(`  ${leg.symbol}: ${leg.weightBps / 100}%`);

  const coinMint = Keypair.generate();
  const createIx = await pegDesk.createCommodityIx({
    admin: admin.publicKey,
    payer: admin.publicKey,
    coinMint: coinMint.publicKey,
    reserveMint: usdcMint,
    symbol: index.symbol,
    oracleKind: index.oracle.kind,
    sessionKind: index.session,
    feedId: Buffer.alloc(32), // Composite: legs carry the feeds
    feedAccount: PublicKey.default,
    fxFeedId: Buffer.alloc(32),
    fxFeedAccount: PublicKey.default,
    quoteScale: 0,
    pythMinSignatures: 0,
    name: (index.displayName ?? index.name).slice(0, 32),
    uri: process.env.METADATA_BASE_URI ? `${process.env.METADATA_BASE_URI}/${index.symbol}.json` : "",
    params: {
      baseSpreadBps: index.params.baseSpreadBps,
      closedSpreadBps: index.params.closedSpreadBps,
      confMultBps: index.params.confMultBps,
      maxAgeOpenSec: index.params.maxAgeOpenSec,
      maxAgeClosedSec: index.params.maxAgeClosedSec,
      supplyCap: toBase(index.params.supplyCapUsd),
      perTxCap: toBase(index.params.perTxCapUsd),
    },
  });
  await send(connection, admin, [createIx], [coinMint], 400_000);

  // set_index_legs(legs: Vec<IndexLeg{commodity, weight_bps, _pad}>), remaining = leg Commodity PDAs in order.
  const setLegsIx = await pegDesk.setIndexLegsIx({ authority: admin.publicKey, symbol: index.symbol, legs });
  await send(connection, admin, [setLegsIx]);

  console.log(`  commodity PDA: ${pegDesk.commodityPda(index.symbol).toBase58()}`);
  console.log(`  coin mint:     ${coinMint.publicKey.toBase58()}`);
}

interface DeploymentFile {
  cluster: string;
  commodities: { symbol: string; commodityPda: string; coinMint: string; seedPriceUsd?: number }[];
}

function readDeployment(cluster: string): DeploymentFile | null {
  const p = path.join(process.cwd(), "deployments", `${cluster}.json`);
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DeploymentFile;
  } catch {
    return null;
  }
}

async function send(connection: Connection, payer: Keypair, ixs: TransactionInstruction[], extraSigners: Keypair[] = [], cu = 200_000): Promise<string> {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs);
  return sendAndConfirmTransaction(connection, tx, [payer, ...extraSigners], { commitment: "confirmed" });
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
