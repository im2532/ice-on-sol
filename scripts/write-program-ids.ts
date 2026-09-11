#!/usr/bin/env tsx
/**
 * Reads each program's deployed keypair from `target/deploy/*.json` (written by
 * `anchor deploy`) and rewrites every place a program id placeholder lives:
 * `Anchor.toml`, `.env`, `packages/registry/src/programs.ts`'s `PROGRAM_IDS`, and each
 * program's `declare_id!` line in `programs/<name>/src/lib.rs`.
 *
 * Usage: `pnpm exec tsx scripts/write-program-ids.ts` (run after `anchor deploy`, per
 * the Makefile's `devnet-deploy` target).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

const REPO_ROOT = process.cwd();

/** program key (as used in Anchor.toml / registry) -> { keypair file, lib.rs path }. */
const PROGRAMS: Record<string, { keypairFile: string; libRsPath: string; registryKey: string; envKey: string }> = {
  peg_desk: {
    keypairFile: "target/deploy/peg_desk-keypair.json",
    libRsPath: "programs/peg_desk/src/lib.rs",
    registryKey: "pegDesk",
    envKey: "PEG_DESK_PROGRAM_ID",
  },
  fee_router: {
    keypairFile: "target/deploy/fee_router-keypair.json",
    libRsPath: "programs/fee_router/src/lib.rs",
    registryKey: "feeRouter",
    envKey: "FEE_ROUTER_PROGRAM_ID",
  },
  distributor: {
    keypairFile: "target/deploy/distributor-keypair.json",
    libRsPath: "programs/distributor/src/lib.rs",
    registryKey: "distributor",
    envKey: "DISTRIBUTOR_PROGRAM_ID",
  },
  buyback: {
    keypairFile: "target/deploy/buyback-keypair.json",
    libRsPath: "programs/buyback/src/lib.rs",
    registryKey: "buyback",
    envKey: "BUYBACK_PROGRAM_ID",
  },
};

function pubkeyFromKeypairFile(relPath: string): string | null {
  const full = path.join(REPO_ROOT, relPath);
  if (!existsSync(full)) {
    console.warn(`  ! ${relPath} not found (has \`anchor build\`/\`anchor deploy\` run?) — skipping`);
    return null;
  }
  const secret = JSON.parse(readFileSync(full, "utf8")) as number[];
  const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
  return kp.publicKey.toBase58();
}

function replaceAll(content: string, oldValue: string, newValue: string): { content: string; count: number } {
  const count = content.split(oldValue).length - 1;
  return { content: content.split(oldValue).join(newValue), count };
}

function updateAnchorToml(ids: Record<string, string>): void {
  const p = path.join(REPO_ROOT, "Anchor.toml");
  let content = readFileSync(p, "utf8");
  let totalChanges = 0;
  for (const key of Object.keys(PROGRAMS)) {
    const newId = ids[key];
    if (!newId) continue;
    // Anchor.toml has `<key> = "<placeholder>"` under [programs.localnet] and [programs.devnet].
    const regex = new RegExp(`(${key}\\s*=\\s*")[^"]+(")`, "g");
    const before = content;
    content = content.replace(regex, `$1${newId}$2`);
    if (content !== before) totalChanges++;
  }
  writeFileSync(p, content);
  console.log(`  Anchor.toml: updated ${totalChanges} program id(s)`);
}

function updateEnvFile(ids: Record<string, string>): void {
  const p = path.join(REPO_ROOT, ".env");
  const source = existsSync(p) ? p : path.join(REPO_ROOT, ".env.example");
  let content = readFileSync(source, "utf8");
  for (const [key, meta] of Object.entries(PROGRAMS)) {
    const newId = ids[key];
    if (!newId) continue;
    const regex = new RegExp(`^${meta.envKey}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${meta.envKey}=${newId}`);
    } else {
      content += `\n${meta.envKey}=${newId}`;
    }
  }
  writeFileSync(path.join(REPO_ROOT, ".env"), content);
  console.log(`  .env: written (source: ${path.basename(source)})`);
}

function updateRegistryProgramsTs(ids: Record<string, string>): void {
  const p = path.join(REPO_ROOT, "packages/registry/src/programs.ts");
  let content = readFileSync(p, "utf8");
  let changes = 0;
  for (const [key, meta] of Object.entries(PROGRAMS)) {
    const newId = ids[key];
    if (!newId) continue;
    const regex = new RegExp(`(${meta.registryKey}\\s*:\\s*")[^"]+(")`);
    const before = content;
    content = content.replace(regex, `$1${newId}$2`);
    if (content !== before) changes++;
  }
  writeFileSync(p, content);
  console.log(`  packages/registry/src/programs.ts: updated ${changes} program id(s)`);
}

function updateDeclareId(programKey: string, newId: string, libRsPath: string): void {
  const p = path.join(REPO_ROOT, libRsPath);
  if (!existsSync(p)) {
    console.warn(`  ! ${libRsPath} not found — skipping declare_id! update for ${programKey}`);
    return;
  }
  let content = readFileSync(p, "utf8");
  const regex = /declare_id!\("[^"]+"\);/;
  if (!regex.test(content)) {
    console.warn(`  ! no declare_id! found in ${libRsPath} — skipping`);
    return;
  }
  content = content.replace(regex, `declare_id!("${newId}");`);
  writeFileSync(p, content);
  console.log(`  ${libRsPath}: declare_id! updated`);
}

function main(): void {
  console.log("Resolving deployed program ids from target/deploy/*.json...");
  const ids: Record<string, string> = {};
  for (const [key, meta] of Object.entries(PROGRAMS)) {
    const id = pubkeyFromKeypairFile(meta.keypairFile);
    if (id) {
      ids[key] = id;
      console.log(`  ${key} -> ${id}`);
    }
  }

  if (Object.keys(ids).length === 0) {
    console.error("No program keypairs found under target/deploy/ — run `anchor build` first.");
    process.exit(1);
  }

  updateAnchorToml(ids);
  updateEnvFile(ids);
  updateRegistryProgramsTs(ids);
  for (const [key, meta] of Object.entries(PROGRAMS)) {
    if (ids[key]) updateDeclareId(key, ids[key], meta.libRsPath);
  }

  console.log("Done. Re-run `anchor build` so the on-chain program's embedded id matches its declare_id!.");
}

main();
