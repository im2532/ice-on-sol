/**
 * Anchor program handles for the keeper. IDLs are read at RUNTIME from `target/idl/<name>.json`
 * (override the directory with `IDL_DIR`), so once `anchor build` has run the keeper works without
 * code edits. The IDL's `address` is replaced by the program id from the keeper config
 * (`PEG_DESK_PROGRAM_ID` etc.), so one IDL serves every cluster.
 *
 * All instruction builders in src/cycles/* use `program.methods.<camelCaseIx>(...).accountsPartial({...})`
 * where the account keys are the camelCase of the Rust `#[derive(Accounts)]` field names (Anchor 0.31
 * camelCases the IDL in the TS client).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AnchorProvider, EventParser, Program, Wallet } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PegDeskClient } from "@icemarkets/sdk";
import { loadConfig } from "./config";
import { getConnection, getKeeperKeypair } from "./rpc";

export type ProgramName = "peg_desk" | "fee_router" | "distributor" | "buyback";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProgram = Program<any>;

const cache = new Map<ProgramName, AnyProgram>();
let provider: AnchorProvider | null = null;
let pegDeskClient: PegDeskClient | null = null;

export function idlDir(): string {
  // apps/keeper/src -> repo root /target/idl
  return process.env.IDL_DIR ?? path.resolve(__dirname, "..", "..", "..", "target", "idl");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadIdl(name: ProgramName): any {
  const file = path.join(idlDir(), `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(`IDL not found at ${file} — run \`anchor build\` (or set IDL_DIR) before starting the keeper`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

export function programId(name: ProgramName): PublicKey {
  const cfg = loadConfig();
  switch (name) {
    case "peg_desk":
      return new PublicKey(cfg.pegDeskProgramId);
    case "fee_router":
      return new PublicKey(cfg.feeRouterProgramId);
    case "distributor":
      return new PublicKey(cfg.distributorProgramId);
    case "buyback":
      return new PublicKey(cfg.buybackProgramId);
  }
}

export function getProvider(): AnchorProvider {
  if (provider) return provider;
  provider = new AnchorProvider(getConnection(), new Wallet(getKeeperKeypair()), { commitment: "confirmed" });
  return provider;
}

export function getProgram(name: ProgramName): AnyProgram {
  const hit = cache.get(name);
  if (hit) return hit;
  const idl = loadIdl(name);
  const program = new Program({ ...idl, address: programId(name).toBase58() }, getProvider());
  cache.set(name, program);
  return program;
}

export function getPegDeskClient(): PegDeskClient {
  if (pegDeskClient) return pegDeskClient;
  pegDeskClient = new PegDeskClient(getProvider(), loadIdl("peg_desk"), programId("peg_desk"));
  return pegDeskClient;
}

/** Decodes Anchor events (`emit!`) of `name` from a confirmed transaction's logs. */
export async function parseEvents(name: ProgramName, signature: string): Promise<{ name: string; data: Record<string, unknown> }[]> {
  const tx = await getConnection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const logs = tx?.meta?.logMessages ?? [];
  const program = getProgram(name);
  const parser = new EventParser(program.programId, program.coder);
  return [...parser.parseLogs(logs)].map((e) => ({ name: e.name, data: e.data as Record<string, unknown> }));
}
