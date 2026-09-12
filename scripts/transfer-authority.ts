#!/usr/bin/env tsx
/**
 * Hands every admin role to a new authority — on mainnet, the Squads vault (MAINNET_PLAN §3).
 *
 *   fee_router   set_programs(…, new_admin)          immediate
 *   distributor  set_params(new_admin)                immediate
 *   buyback      set_params(new_admin)                immediate (skipped if not initialised)
 *   peg_desk     propose_admin(new_admin)             two-step: the new authority must send accept_admin
 *                                                      (from Squads: create a proposal with that instruction)
 *   upgrade authority of the 4 programs               printed as `solana program set-upgrade-authority` commands
 *                                                      (or executed with --upgrade when the current authority is
 *                                                      ADMIN_KEYPAIR_PATH; `--skip-new-upgrade-authority-signer-check`
 *                                                      is required for a multisig vault that cannot sign)
 *
 * Dry-run by default; pass --execute to send. Refuses on mainnet unless the target is confirmed twice
 * (CONFIRM_NEW_AUTHORITY=<pubkey> must equal --to).
 *
 * Usage: pnpm exec tsx scripts/transfer-authority.ts --to <pubkey> [--execute] [--upgrade]
 * Env: RPC_URL, ADMIN_KEYPAIR_PATH, SOLANA_CLUSTER, *_PROGRAM_ID, [IDL_DIR]
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { parseCluster } from "@icemarkets/registry";
import { buyback as buybackPda, distributor as distributorPda, feeRouter as feeRouterPda, pegDesk as pegDeskPda } from "@icemarkets/sdk";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const to = new PublicKey(argValue(args, "--to") ?? requireEnv("NEW_AUTHORITY"));
  const execute = args.includes("--execute");
  const doUpgrade = args.includes("--upgrade");
  const cluster = parseCluster(process.env.SOLANA_CLUSTER);
  if (cluster === "mainnet-beta" && execute && process.env.CONFIRM_NEW_AUTHORITY !== to.toBase58()) {
    throw new Error(`mainnet: set CONFIRM_NEW_AUTHORITY=${to.toBase58()} to execute (typo protection — this is irreversible)`);
  }
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(requireEnv("ADMIN_KEYPAIR_PATH"), "utf8"))));
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const ids = {
    pegDesk: new PublicKey(requireEnv("PEG_DESK_PROGRAM_ID")),
    feeRouter: new PublicKey(requireEnv("FEE_ROUTER_PROGRAM_ID")),
    distributor: new PublicKey(requireEnv("DISTRIBUTOR_PROGRAM_ID")),
    buyback: new PublicKey(requireEnv("BUYBACK_PROGRAM_ID")),
  };
  const withAddress = (idl: any, address: PublicKey) => ({ ...idl, address: address.toBase58() });
  const load = (name: string, id: PublicKey) => new Program(withAddress(loadIdl(name), id), provider) as any;
  const pegDesk = load("peg_desk", ids.pegDesk);
  const feeRouter = load("fee_router", ids.feeRouter);
  const distributor = load("distributor", ids.distributor);
  const buyback = load("buyback", ids.buyback);

  console.log(`${execute ? "EXECUTING" : "dry run"} — ${cluster} — new authority ${to.toBase58()} — current admin ${admin.publicKey.toBase58()}`);
  const steps: { name: string; run: () => Promise<string> }[] = [];

  const routerCfg = await feeRouter.account.routerConfig.fetch(feeRouterPda.router(ids.feeRouter)[0]);
  steps.push({
    name: `fee_router.set_programs(new_admin) [current ${routerCfg.admin.toBase58()}]`,
    run: () =>
      feeRouter.methods
        .setPrograms(routerCfg.distributorProgram, routerCfg.buybackProgram, routerCfg.pegDeskProgram, to)
        .accountsPartial({ admin: admin.publicKey, config: feeRouterPda.router(ids.feeRouter)[0] })
        .rpc(),
  });
  const distCfg = await distributor.account.distConfig.fetch(distributorPda.config(ids.distributor)[0]);
  steps.push({
    name: `distributor.set_params(new_admin) [current ${distCfg.admin.toBase58()}]`,
    run: () =>
      distributor.methods
        .setParams(null, null, null, to)
        .accountsPartial({ admin: admin.publicKey, distConfig: distributorPda.config(ids.distributor)[0] })
        .rpc(),
  });
  const bbState = await buyback.account.buybackState.fetchNullable(buybackPda.state(ids.buyback)[0]);
  if (bbState) {
    steps.push({
      name: `buyback.set_params(new_admin) [current ${bbState.admin.toBase58()}]`,
      run: () =>
        buyback.methods
          .setParams({ feeRouter: null, pegDesk: null, swapProgram: null, reserveBufferBps: null, maxPerCycleUsdc: null, maxDeviationBps: null, anchorMoveBps: null, minIntervalSecs: null, icePerUsdcAnchor: null, paused: null, keepers: null, newAdmin: to })
          .accountsPartial({ admin: admin.publicKey, state: buybackPda.state(ids.buyback)[0] })
          .rpc(),
    });
  } else {
    console.log("  (buyback not initialised — skipped)");
  }
  const pegCfg = await pegDesk.account.globalConfig.fetch(pegDeskPda.config(ids.pegDesk)[0]);
  steps.push({
    name: `peg_desk.propose_admin(new_admin) [current ${pegCfg.admin.toBase58()}] — then accept_admin from ${to.toBase58()}`,
    run: () =>
      pegDesk.methods
        .proposeAdmin(to)
        .accountsPartial({ admin: admin.publicKey, config: pegDeskPda.config(ids.pegDesk)[0] })
        .rpc(),
  });

  for (const s of steps) {
    if (!execute) {
      console.log(`  would: ${s.name}`);
      continue;
    }
    const sig = await s.run();
    console.log(`  done: ${s.name} (${sig})`);
  }

  console.log("\nupgrade authority:");
  const url = requireEnv("RPC_URL");
  for (const [name, id] of Object.entries(ids)) {
    const cmd = `solana program set-upgrade-authority ${id.toBase58()} --new-upgrade-authority ${to.toBase58()} --skip-new-upgrade-authority-signer-check --upgrade-authority ${requireEnv("ADMIN_KEYPAIR_PATH")} --url ${url}`;
    if (execute && doUpgrade) {
      console.log(`  ${name}: ${execSync(cmd, { encoding: "utf8" }).trim()}`);
    } else {
      console.log(`  ${name}: ${cmd}`);
    }
  }
  console.log(
    "\nnext: from the new authority send peg_desk.accept_admin (Squads: proposal with that instruction), then verify with\n  solana program show <id> --url $RPC_URL   (Authority must be the new key on all four)",
  );
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
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
