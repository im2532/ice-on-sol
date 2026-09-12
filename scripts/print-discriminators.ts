/**
 * Prints Anchor discriminators used by the hand-built CPIs in programs/{fee_router,distributor,buyback},
 * and (optionally) checks them against Meteora IDLs and against the constants in our Rust sources.
 *
 *   pnpm exec tsx scripts/print-discriminators.ts                 # print table + Rust arrays
 *   pnpm exec tsx scripts/print-discriminators.ts --check         # also assert Rust constants match
 *   pnpm exec tsx scripts/print-discriminators.ts dbc.json cp_amm.json   # diff vs IDLs (Anchor ≥0.30 IDL format)
 *
 * Instruction discriminator = sha256("global:<snake_name>")[..8]; account = sha256("account:<TypeName>")[..8].
 * (Works with plain `node --experimental-strip-types` too.)
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const disc = (preimage: string): number[] => [...createHash("sha256").update(preimage).digest().subarray(0, 8)];

const INSTRUCTIONS: { program: string; name: string; note: string }[] = [
  { program: "dbc", name: "claim_trading_fee", note: "fee_router::claim_dbc CPI" },
  { program: "dbc", name: "partner_withdraw_surplus", note: "fee_router::claim_dbc_surplus CPI" },
  { program: "dbc", name: "migration_damm_v2", note: "keeper top-level only (not CPI'd)" },
  { program: "cp_amm", name: "claim_position_fee", note: "fee_router::claim_damm CPI" },
  { program: "cp_amm", name: "swap", note: "buyback::convert_and_burn CPI" },
  { program: "fee_router", name: "withdraw_for_epoch", note: "distributor::open_epoch CPI" },
  { program: "fee_router", name: "withdraw_for_buyback", note: "buyback::convert_and_burn CPI" },
  { program: "fee_router", name: "register_pool", note: "packages/sdk/src/feeRouter.ts (hand-encoded, launch tx)" },
  { program: "distributor", name: "claim", note: "packages/sdk/src/distributor.ts (hand-encoded, rewards page)" },
];

const ACCOUNTS: { program: string; name: string; note: string }[] = [
  { program: "dbc", name: "PoolConfig", note: "register_pool layout check" },
  { program: "dbc", name: "VirtualPool", note: "register_pool / record_migration layout check" },
  { program: "cp_amm", name: "Pool", note: "record_migration" },
  { program: "cp_amm", name: "Position", note: "record_migration" },
];

function printTable() {
  console.log("Instruction discriminators  sha256(\"global:<name>\")[..8]");
  for (const i of INSTRUCTIONS) {
    const d = disc(`global:${i.name}`);
    console.log(`  ${i.program.padEnd(11)} ${i.name.padEnd(26)} [${d.join(", ")}]  // ${i.note}`);
  }
  console.log("\nAccount discriminators  sha256(\"account:<Type>\")[..8]");
  for (const a of ACCOUNTS) {
    const d = disc(`account:${a.name}`);
    console.log(`  ${a.program.padEnd(11)} ${a.name.padEnd(26)} [${d.join(", ")}]  // ${a.note}`);
  }
}

/** Anchor ≥0.30 IDLs carry explicit `discriminator` arrays; older IDLs don't (then we only print). */
function checkIdl(path: string): number {
  const idl = JSON.parse(readFileSync(path, "utf8"));
  const label = idl?.metadata?.name ?? idl?.name ?? path;
  let bad = 0;
  console.log(`\nIDL ${label} (${path})`);
  const toSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  for (const want of INSTRUCTIONS) {
    const ix = (idl.instructions ?? []).find((x: any) => x.name === want.name || toSnake(x.name) === want.name);
    if (!ix) continue;
    const expected = disc(`global:${want.name}`);
    const actual: number[] | undefined = ix.discriminator;
    const ok = !actual || actual.join() === expected.join();
    if (!ok) bad++;
    console.log(`  ix ${want.name.padEnd(26)} ${actual ? (ok ? "OK" : `MISMATCH idl=[${actual}]`) : "(no discriminator in IDL)"}`);
    const accts = (ix.accounts ?? []).map((a: any) => `${a.name}${a.writable || a.isMut ? "*" : ""}${a.signer || a.isSigner ? "!" : ""}`);
    console.log(`     accounts (${accts.length}): ${accts.join(", ")}`);
    if (ix.args) console.log(`     args: ${JSON.stringify(ix.args.map((a: any) => `${a.name}:${JSON.stringify(a.type)}`))}`);
  }
  for (const want of ACCOUNTS) {
    const acc = (idl.accounts ?? []).find((x: any) => x.name === want.name);
    if (!acc) continue;
    const expected = disc(`account:${want.name}`);
    const actual: number[] | undefined = acc.discriminator;
    const ok = !actual || actual.join() === expected.join();
    if (!ok) bad++;
    console.log(`  account ${want.name.padEnd(21)} ${actual ? (ok ? "OK" : `MISMATCH idl=[${actual}]`) : "(no discriminator in IDL)"}`);
  }
  return bad;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".rs")) out.push(p);
  }
  return out;
}

/** Finds `sha256("global:x")[..8]` doc comments followed by `pub const X: [u8; 8] = [...]` and checks them. */
function checkRustConstants(): number {
  // Run from the repo root (pnpm exec does this).
  const root = resolve(process.cwd(), "programs");
  const re = /sha256\("((?:global|account):\w+)"\)\[\.\.8\][^\n]*(?:\n\s*\/\/\/[^\n]*)*\n\s*pub const (\w+): \[u8; 8\] = \[([^\]]+)\]/g;
  let bad = 0;
  let n = 0;
  console.log("\nRust constants");
  for (const dir of ["fee_router", "distributor", "buyback"]) {
    let files: string[] = [];
    try {
      files = walk(join(root, dir, "src"));
    } catch {
      continue;
    }
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(re)) {
        n++;
        const expected = disc(m[1]).join(", ");
        const actual = m[3].split(",").map((s) => s.trim()).filter(Boolean).join(", ");
        const ok = expected === actual;
        if (!ok) bad++;
        console.log(`  ${ok ? "OK      " : "MISMATCH"} ${m[2].padEnd(40)} ${m[1]}${ok ? "" : `  expected [${expected}] got [${actual}]`}  (${f.slice(root.length + 1)})`);
      }
    }
  }
  if (n === 0) console.log("  (no annotated constants found)");
  return bad;
}

/** Same check for the hand-encoded SDK builders: `/** sha256("global:x")[..8] *\/ export const X = Buffer.from([...])`. */
function checkTsConstants(): number {
  const dir = resolve(process.cwd(), "packages", "sdk", "src");
  const re = /sha256\("((?:global|account):\w+)"\)\[\.\.8\][^\n]*\n\s*export const (\w+) = Buffer\.from\(\[([^\]]+)\]\)/g;
  let bad = 0;
  console.log("\nSDK (TS) constants");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(re)) {
      const expected = disc(m[1]).join(", ");
      const actual = m[3].split(",").map((x) => x.trim()).filter(Boolean).join(", ");
      const ok = expected === actual;
      if (!ok) bad++;
      console.log(`  ${ok ? "OK      " : "MISMATCH"} ${m[2].padEnd(40)} ${m[1]}${ok ? "" : `  expected [${expected}] got [${actual}]`}  (${f})`);
    }
  }
  return bad;
}

const args = process.argv.slice(2);
printTable();
let failures = 0;
if (args.includes("--check")) failures += checkRustConstants() + checkTsConstants();
for (const p of args.filter((a) => !a.startsWith("--"))) failures += checkIdl(p);
if (failures > 0) {
  console.error(`\n${failures} mismatch(es)`);
  process.exit(1);
}
