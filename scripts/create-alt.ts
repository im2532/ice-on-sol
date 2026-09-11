#!/usr/bin/env tsx
/**
 * Creates (or extends) the launch Address Lookup Table with every STATIC account the one-tx launch
 * (packages/sdk/src/launch.ts) touches, and records it in `deployments/<cluster>.json` as
 * `addressLookupTable` (merged — seed-commodities.ts keeps it). The web launch builder and
 * `buildLaunchTransactions({ addressLookupTable })` load it from there.
 *
 * Contents (priority order; an ALT holds at most 256 addresses):
 *   1. programs: peg_desk, fee_router, distributor, buyback, DBC, DAMM v2, Metaplex, SPL Token, Token-2022,
 *      Associated Token, System, ComputeBudget; sysvars Rent + Instructions; USDC (cluster) + wSOL mints;
 *      peg_desk GlobalConfig + mint_auth; fee_router router PDA; DBC / DAMM v2 pool_authority + event_authority.
 *   2. every MVP commodity (+ index coins that exist on-chain): Commodity PDA, coin mint, reserve vault.
 *   3. while room remains: KeeperPrice PDA (KeeperSigned / Switchboard stand-in feed), router COIN ATA,
 *      buyback_vault[coin], treasury[coin] (fee_router `register_pool` accounts per quote coin).
 * Per-launch accounts (DBC config / pool / vaults / metadata, creator ATAs) can never be in a shared ALT.
 *
 * Idempotent: re-running extends the recorded table with whatever is missing (e.g. new commodities).
 * Commodity mints come from deployments/<cluster>.json (seed-commodities.ts) or, if absent there, from the
 * on-chain Commodity account (`coin_mint` at byte offset 8 + 12 — programs/peg_desk/src/state.rs).
 *
 * Env: RPC_URL, ADMIN_KEYPAIR_PATH (ALT authority + payer), [SOLANA_CLUSTER=devnet], [USDC_MINT_OVERRIDE],
 *      [PEG_DESK_PROGRAM_ID, FEE_ROUTER_PROGRAM_ID, DISTRIBUTOR_PROGRAM_ID, BUYBACK_PROGRAM_ID] (default: registry)
 * Usage: pnpm exec tsx scripts/create-alt.ts [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { ALL, OracleKind, PROGRAM_IDS, byPhase, parseCluster, usdcMintFor, type Commodity } from "@icemarkets/registry";
import { ASSOCIATED_TOKEN_PROGRAM, TOKEN_PROGRAM, ata, feeRouter as feeRouterPda, meteora, pegDesk as pegDeskPda } from "@icemarkets/sdk";

const MAX_ALT_ADDRESSES = 256;
const EXTEND_CHUNK = 20; // addresses per extend tx (keeps the tx well under 1232 bytes)
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const COMMODITY_COIN_MINT_OFFSET = 8 + 12; // disc + symbol[12]

interface DeploymentFile {
  cluster?: string;
  commodities?: { symbol: string; commodityPda: string; coinMint: string; reserveVault: string }[];
  addressLookupTable?: string;
  [k: string]: unknown;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const cluster = parseCluster(process.env.SOLANA_CLUSTER);
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(requireEnv("ADMIN_KEYPAIR_PATH"), "utf8")) as number[]));

  const ids = {
    pegDesk: new PublicKey(process.env.PEG_DESK_PROGRAM_ID ?? PROGRAM_IDS.pegDesk),
    feeRouter: new PublicKey(process.env.FEE_ROUTER_PROGRAM_ID ?? PROGRAM_IDS.feeRouter),
    distributor: new PublicKey(process.env.DISTRIBUTOR_PROGRAM_ID ?? PROGRAM_IDS.distributor),
    buyback: new PublicKey(process.env.BUYBACK_PROGRAM_ID ?? PROGRAM_IDS.buyback),
    dbc: new PublicKey(process.env.DBC_PROGRAM_ID ?? PROGRAM_IDS.dbc),
    dammV2: new PublicKey(process.env.DAMM_V2_PROGRAM_ID ?? PROGRAM_IDS.dammV2),
    metaplex: new PublicKey(PROGRAM_IDS.tokenMetadata),
  };
  const usdcMint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT_OVERRIDE));

  const outDir = path.join(process.cwd(), "deployments");
  const outFile = path.join(outDir, `${cluster}.json`);
  const deployment: DeploymentFile = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, "utf8")) as DeploymentFile) : { cluster };

  // ---- 1. static accounts ---------------------------------------------------------------------------
  const router = feeRouterPda.router(ids.feeRouter)[0];
  const required: PublicKey[] = [
    ids.pegDesk, ids.feeRouter, ids.distributor, ids.buyback, ids.dbc, ids.dammV2, ids.metaplex,
    TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SystemProgram.programId, ComputeBudgetProgram.programId,
    SYSVAR_RENT_PUBKEY, SYSVAR_INSTRUCTIONS_PUBKEY,
    usdcMint, WSOL_MINT,
    pegDeskPda.config(ids.pegDesk)[0], pegDeskPda.mintAuth(ids.pegDesk)[0],
    router,
    meteora.dbcPoolAuthority(), meteora.dbcEventAuthority(), meteora.dammPoolAuthority(), meteora.dammEventAuthority(),
  ];

  // ---- 2/3. commodities -----------------------------------------------------------------------------
  const targets: Commodity[] = [...byPhase("mvp").filter((c) => c.oracle.kind !== OracleKind.Composite), ...ALL.filter((c) => c.oracle.kind === OracleKind.Composite)];
  const optional: PublicKey[] = [];
  let resolved = 0;
  for (const c of targets) {
    const commodity = pegDeskPda.commodity(ids.pegDesk, c.symbol)[0];
    const fromFile = deployment.commodities?.find((e) => e.symbol === c.symbol);
    let coinMint: PublicKey | null = fromFile ? new PublicKey(fromFile.coinMint) : null;
    if (!coinMint) {
      const info = await connection.getAccountInfo(commodity);
      if (!info || !info.owner.equals(ids.pegDesk)) continue; // not seeded on this cluster
      coinMint = new PublicKey(info.data.subarray(COMMODITY_COIN_MINT_OFFSET, COMMODITY_COIN_MINT_OFFSET + 32));
    }
    resolved++;
    required.push(commodity, coinMint, pegDeskPda.reserve(ids.pegDesk, commodity)[0]);
    if (c.oracle.kind === OracleKind.KeeperSigned || c.oracle.kind === OracleKind.Switchboard) optional.push(pegDeskPda.keeperPrice(ids.pegDesk, commodity)[0]);
    optional.push(ata(coinMint, router), feeRouterPda.buybackVault(ids.feeRouter, coinMint)[0], feeRouterPda.treasury(ids.feeRouter, coinMint)[0]);
  }
  if (resolved === 0) throw new Error(`no seeded commodities found on ${cluster} — run scripts/seed-commodities.ts first`);

  const desired = dedupe([...required, ...optional]);
  const requiredCount = dedupe(required).length;
  if (requiredCount > MAX_ALT_ADDRESSES) throw new Error(`required accounts (${requiredCount}) exceed the ALT limit of ${MAX_ALT_ADDRESSES}`);
  const wanted = desired.slice(0, MAX_ALT_ADDRESSES);
  if (desired.length > wanted.length) console.warn(`  ! ${desired.length - wanted.length} optional accounts do not fit (256 max) and were left out`);
  console.log(`${cluster}: ${resolved} commodities, ${requiredCount} required + ${wanted.length - requiredCount} optional addresses`);

  // ---- create or load the table -----------------------------------------------------------------------
  let table: PublicKey | null = deployment.addressLookupTable ? new PublicKey(deployment.addressLookupTable) : null;
  let existing: PublicKey[] = [];
  if (table) {
    const acc = (await connection.getAddressLookupTable(table)).value;
    if (!acc) {
      console.warn(`  ! recorded ALT ${table.toBase58()} not found on-chain — creating a new one`);
      table = null;
    } else {
      if (acc.state.authority && !acc.state.authority.equals(admin.publicKey)) {
        throw new Error(`ALT ${table.toBase58()} authority is ${acc.state.authority.toBase58()}, not ADMIN_KEYPAIR_PATH`);
      }
      existing = acc.state.addresses;
    }
  }
  const have = new Set(existing.map((k) => k.toBase58()));
  const toAdd = wanted.filter((k) => !have.has(k.toBase58())).slice(0, MAX_ALT_ADDRESSES - existing.length);
  if (dryRun) {
    console.log(`dry run: would ${table ? `extend ${table.toBase58()}` : "create a table"} with ${toAdd.length} addresses`);
    return;
  }

  if (!table) {
    const recentSlot = await connection.getSlot("finalized");
    const [createIx, address] = AddressLookupTableProgram.createLookupTable({ authority: admin.publicKey, payer: admin.publicKey, recentSlot });
    await send(connection, admin, [createIx]);
    table = address;
    console.log(`  + created ALT ${table.toBase58()}`);
  }
  for (let i = 0; i < toAdd.length; i += EXTEND_CHUNK) {
    const chunk = toAdd.slice(i, i + EXTEND_CHUNK);
    await send(connection, admin, [AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: admin.publicKey, payer: admin.publicKey, addresses: chunk })]);
    console.log(`  + extended with ${chunk.length} (${Math.min(i + EXTEND_CHUNK, toAdd.length)}/${toAdd.length})`);
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const latest: DeploymentFile = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, "utf8")) as DeploymentFile) : { cluster };
  writeFileSync(
    outFile,
    JSON.stringify({ ...latest, cluster, addressLookupTable: table.toBase58(), addressLookupTableAuthority: admin.publicKey.toBase58(), addressLookupTableSize: existing.length + toAdd.length }, null, 2),
  );
  console.log(`Wrote addressLookupTable=${table.toBase58()} to deployments/${cluster}.json (usable one slot after the last extend)`);
}

function dedupe(keys: PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  return keys.filter((k) => {
    const s = k.toBase58();
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

async function send(connection: Connection, payer: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [payer], { commitment: "confirmed" });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
