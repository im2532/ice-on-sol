#!/usr/bin/env tsx
/**
 * Applies the Peg Desk circuit-breaker defaults (packages/registry/src/risk.ts) to every commodity
 * in deployments/<cluster>.json via `set_commodity_params`. Idempotent: re-running overwrites the
 * four breaker fields and nothing else. Commodities whose on-chain values already match are skipped.
 *
 * Per coin:  daily_mint_cap   = supply_cap (on-chain, coin units) × tier bps
 *            daily_redeem_cap = registry supplyCapUsd × 1e6 × tier bps
 *            max_deviation_bps / deviation_window_secs from the tier
 *
 * Env: RPC_URL, ADMIN_KEYPAIR_PATH, PEG_DESK_PROGRAM_ID, [SOLANA_CLUSTER=devnet], [IDL_DIR=target/idl],
 *      [ONLY=GLD,SLV] (subset), [DRY_RUN=1] (print, don't send), [DISABLE=1] (set every breaker to 0),
 *      [BREAKER_SCALE_BPS=10000] — scales the daily caps (not the deviation bound). MAINNET_RUNBOOK's guarded
 *      launch uses 1000 (10% of the tier caps) until the audit is in; raise it in steps afterwards.
 * Usage: pnpm exec tsx scripts/set-breakers.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { COMMODITIES, breakerCaps, parseCluster } from "@icemarkets/registry";
import { PegDeskClient } from "@icemarkets/sdk";

interface DeploymentFile {
  cluster: string;
  commodities: { symbol: string; commodityPda: string; supplyCap: string }[];
}

async function main(): Promise<void> {
  const cluster = parseCluster(process.env.SOLANA_CLUSTER);
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(requireEnv("ADMIN_KEYPAIR_PATH"), "utf8"))));
  const programId = new PublicKey(requireEnv("PEG_DESK_PROGRAM_ID"));
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const pegDesk = new PegDeskClient(provider, loadIdl("peg_desk"), programId);

  const depFile = path.join(process.cwd(), "deployments", `${cluster}.json`);
  if (!existsSync(depFile)) throw new Error(`no ${depFile} — run make seed first`);
  const dep = JSON.parse(readFileSync(depFile, "utf8")) as DeploymentFile;
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : null;
  const dryRun = process.env.DRY_RUN === "1";
  const disable = process.env.DISABLE === "1";
  const scaleBps = BigInt(process.env.BREAKER_SCALE_BPS ?? "10000");

  const bySymbol = new Map(COMMODITIES.map((c) => [c.symbol, c]));
  let sent = 0;
  let skipped = 0;
  for (const entry of dep.commodities) {
    if (only && !only.has(entry.symbol)) continue;
    const reg = bySymbol.get(entry.symbol);
    if (!reg) {
      console.warn(`  ! ${entry.symbol} not in registry — skipped`);
      continue;
    }
    const view = await pegDesk.fetchCommodityView(entry.symbol);
    const base = breakerCaps(reg.tier, view.supplyCap, reg.params.supplyCapUsd);
    const target = disable
      ? { dailyMintCap: 0n, dailyRedeemCap: 0n, maxDeviationBps: 0, deviationWindowSecs: 0 }
      : { ...base, dailyMintCap: (base.dailyMintCap * scaleBps) / 10_000n, dailyRedeemCap: (base.dailyRedeemCap * scaleBps) / 10_000n };
    const b = view.breakers;
    const same =
      b.dailyMintCap === target.dailyMintCap &&
      b.dailyRedeemCap === target.dailyRedeemCap &&
      b.maxDeviationBps === target.maxDeviationBps &&
      b.deviationWindowSecs === target.deviationWindowSecs;
    const line = `${entry.symbol.padEnd(11)} tier ${reg.tier.padEnd(6)} mint/day ${fmt(target.dailyMintCap)} coin  redeem/day ${fmt(target.dailyRedeemCap)} USDC  dev ${target.maxDeviationBps} bps / ${target.deviationWindowSecs} s`;
    if (same) {
      skipped++;
      console.log(`  = ${line}`);
      continue;
    }
    console.log(`  ${dryRun ? "~" : "→"} ${line}`);
    if (dryRun) continue;
    const ix = await pegDesk.setCommodityParamsIx({ admin: admin.publicKey, symbol: entry.symbol, ...target });
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }), ix);
    await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
    sent++;
  }
  console.log(`done: ${sent} updated, ${skipped} already current${dryRun ? " (dry run)" : ""}`);
}

function fmt(baseUnits: bigint): string {
  return (Number(baseUnits) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 });
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
