/**
 * Connection + priority-fee-aware transaction sending, with basic retry and an optional
 * Jito bundle path. Every keeper cycle sends through `sendWithPriority` rather than
 * `connection.sendTransaction` directly, so priority fees / CU limits / retries are
 * consistent across cycles.
 */
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { loadConfig } from "./config";
import { childLogger } from "./logger";

const log = childLogger("rpc");

let connection: Connection | null = null;
let keeperKeypair: Keypair | null = null;

export function getConnection(): Connection {
  if (connection) return connection;
  const cfg = loadConfig();
  connection = new Connection(cfg.rpcUrl, { commitment: "confirmed", wsEndpoint: cfg.wsUrl });
  return connection;
}

export function getKeeperKeypair(): Keypair {
  if (keeperKeypair) return keeperKeypair;
  const cfg = loadConfig();
  const raw = JSON.parse(readFileSync(cfg.keeperKeypairPath, "utf8")) as number[];
  keeperKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));
  return keeperKeypair;
}

export interface SendWithPriorityOpts {
  cuLimit?: number;
  priorityMicroLamports?: number;
  /** Extra signers beyond the keeper keypair (e.g. a new-account keypair for an init ix). */
  extraSigners?: Keypair[];
  maxRetries?: number;
}

/**
 * Sends a set of instructions as one transaction from the keeper keypair, with a
 * ComputeBudget prefix (unit limit + priority fee) and simple retry-with-backoff.
 *
 * Jito: when `JITO_BUNDLE_URL` is configured, cycles that want landing-priority during
 * contention should route through `sendJitoBundle` instead (stubbed below) — most keeper
 * traffic (oracle pushes, fee claims) is fine with plain priority fees, so this function
 * stays the default path per docs/research/03 ("land via Jito bundle or high priority fee
 * (prop-AMM style)").
 */
export async function sendWithPriority(ixs: TransactionInstruction[], opts: SendWithPriorityOpts = {}): Promise<string> {
  const cfg = loadConfig();
  const conn = getConnection();
  const payer = getKeeperKeypair();
  const cuLimit = opts.cuLimit ?? cfg.computeUnitLimit;
  const priorityMicroLamports = opts.priorityMicroLamports ?? cfg.priorityMicroLamports;
  const maxRetries = opts.maxRetries ?? 3;

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }),
    ...ixs,
  );

  const signers = [payer, ...(opts.extraSigners ?? [])];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(...signers);
      const raw = tx.serialize();
      const sig = await sendAndConfirmRawTransaction(conn, raw, {
        commitment: "confirmed",
        maxRetries: 0, // we handle retries ourselves so we can refresh the blockhash each time
      });
      return sig;
    } catch (err) {
      lastErr = err;
      log.warn({ attempt, err: String(err) }, "sendWithPriority: attempt failed, retrying");
      await sleep(300 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`sendWithPriority: failed after ${maxRetries} attempts`);
}

/**
 * Jito bundle stub. CHECK vs Jito's Block Engine HTTP API (`sendBundle` JSON-RPC over the
 * configured relay URL, base58/base64-encoded signed transactions, tip instruction to a
 * Jito tip account) before using in production — not implemented against a live endpoint
 * in this sandbox (no network). Falls back to `sendWithPriority` when no bundle URL is
 * configured, which is the correct behavior for non-mainnet / non-contention scenarios.
 */
export async function sendJitoBundle(ixs: TransactionInstruction[], opts: SendWithPriorityOpts = {}): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.jitoBundleUrl) {
    log.debug("sendJitoBundle: no JITO_BUNDLE_URL configured, falling back to sendWithPriority");
    return sendWithPriority(ixs, opts);
  }
  // CHECK: implement the actual bundle submission + tip instruction once JITO_BUNDLE_URL
  // is set for a real deployment.
  throw new Error("sendJitoBundle: not implemented — JITO_BUNDLE_URL is set but no bundle client is wired up yet");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Same as `sendWithPriority` but compiles a v0 transaction against address lookup tables — needed
 * when an instruction carries a Jupiter route (buyback) or otherwise exceeds the legacy account limit.
 */
export async function sendV0WithPriority(
  ixs: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[],
  opts: SendWithPriorityOpts = {},
): Promise<string> {
  const cfg = loadConfig();
  const conn = getConnection();
  const payer = getKeeperKeypair();
  const cuLimit = opts.cuLimit ?? cfg.computeUnitLimit;
  const priorityMicroLamports = opts.priorityMicroLamports ?? cfg.priorityMicroLamports;
  const maxRetries = opts.maxRetries ?? 3;
  const all = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }),
    ...ixs,
  ];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: all }).compileToV0Message(lookupTables);
      const tx = new VersionedTransaction(msg);
      tx.sign([payer, ...(opts.extraSigners ?? [])]);
      const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 0, skipPreflight: false });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      return sig;
    } catch (err) {
      lastErr = err;
      log.warn({ attempt, err: String(err) }, "sendV0WithPriority: attempt failed, retrying");
      await sleep(300 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`sendV0WithPriority: failed after ${maxRetries} attempts`);
}
