#!/usr/bin/env tsx
/**
 * One-time program configs on the current cluster (idempotent: skips accounts that already exist):
 *   fee_router.initialize_router  — 5000/2500/2500 split (CONTRACTS §2), program ids from .env
 *   distributor.initialize        — fee_router id, max_push_per_epoch_bps 10000
 *   set_keepers on both           — from KEEPER_PUBKEYS (idempotent)
 * buyback.initialize needs the $ICE mint + ICE/GLD DAMM pool (not created yet) — run separately later.
 * Env: RPC_URL, ADMIN_KEYPAIR_PATH, *_PROGRAM_ID (as written by scripts/write-program-ids.ts), [IDL_DIR].
 * Run: `pnpm exec tsx scripts/init-programs.ts` (with .env exported; `make init-programs`).
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SPLIT = { holdersBps: 5000, buybackBps: 2500, protocolBps: 2500 };
const MAX_PUSH_PER_EPOCH_BPS = 10_000;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function loadIdl(name: string): any {
  const file = path.join(process.env.IDL_DIR ?? path.join(process.cwd(), "target", "idl"), `${name}.json`);
  if (!existsSync(file)) throw new Error(`IDL not found at ${file} — run \`anchor build\` first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

async function main(): Promise<void> {
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
  const feeRouter = new Program(withAddress(loadIdl("fee_router"), ids.feeRouter), provider);
  const distributor = new Program(withAddress(loadIdl("distributor"), ids.distributor), provider);

  const [router] = PublicKey.findProgramAddressSync([Buffer.from("router")], ids.feeRouter);
  if (await connection.getAccountInfo(router)) {
    console.log(`fee_router router ${router.toBase58()} already initialized — skipped`);
  } else {
    const sig = await (feeRouter.methods as any)
      .initializeRouter({ distributorProgram: ids.distributor, buybackProgram: ids.buyback, pegDeskProgram: ids.pegDesk, ...SPLIT })
      .accountsPartial({ payer: admin.publicKey, config: router, systemProgram: SystemProgram.programId })
      .rpc();
    console.log(`fee_router initialize_router -> ${router.toBase58()} (${sig})`);
  }

  const [distConfig] = PublicKey.findProgramAddressSync([Buffer.from("dist")], ids.distributor);
  if (await connection.getAccountInfo(distConfig)) {
    console.log(`distributor config ${distConfig.toBase58()} already initialized — skipped`);
  } else {
    const sig = await (distributor.methods as any)
      .initialize(ids.feeRouter, MAX_PUSH_PER_EPOCH_BPS)
      .accountsPartial({ payer: admin.publicKey, distConfig, systemProgram: SystemProgram.programId })
      .rpc();
    console.log(`distributor initialize -> ${distConfig.toBase58()} (${sig})`);
  }
  console.log("buyback.initialize: skipped (needs $ICE mint + ICE/GLD pool)");

  // Keepers: fee_router + distributor mirror peg_desk's `set_keepers` (seed-commodities.ts does peg_desk).
  // Without this the keeper's fee/payout cycles fail with Unauthorized (claims are permissionless only
  // after the first 900 s window; open_epoch never is).
  const keepers = (process.env.KEEPER_PUBKEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => new PublicKey(s));
  if (keepers.length === 0) {
    console.log("KEEPER_PUBKEYS unset — keepers not registered on fee_router / distributor");
    return;
  }
  const same = (onchain: { keepers: PublicKey[]; keeperCount: number }) => {
    const cur = onchain.keepers.slice(0, onchain.keeperCount).map((k) => k.toBase58()).sort();
    const want = keepers.map((k) => k.toBase58()).sort();
    return cur.length === want.length && cur.every((k, i) => k === want[i]);
  };
  const rc = (await (feeRouter.account as any).routerConfig.fetch(router)) as { keepers: PublicKey[]; keeperCount: number };
  if (same(rc)) console.log(`fee_router keepers already ${keepers.length} — skipped`);
  else {
    const sig = await (feeRouter.methods as any).setKeepers(keepers).accountsPartial({ admin: admin.publicKey, config: router }).rpc();
    console.log(`fee_router set_keepers (${keepers.length}) ${sig}`);
  }
  const dc = (await (distributor.account as any).distConfig.fetch(distConfig)) as { keepers: PublicKey[]; keeperCount: number };
  if (same(dc)) console.log(`distributor keepers already ${keepers.length} — skipped`);
  else {
    const sig = await (distributor.methods as any).setKeepers(keepers).accountsPartial({ admin: admin.publicKey, distConfig }).rpc();
    console.log(`distributor set_keepers (${keepers.length}) ${sig}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
