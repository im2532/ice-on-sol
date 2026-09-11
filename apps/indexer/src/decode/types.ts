/**
 * Transaction shapes the indexer ingests, and the normalized form every decoder works on.
 *
 * Three input shapes are accepted and normalized into `NormalizedTx` (see normalize.ts):
 *  1. Helius "enhanced" webhook items (`HeliusEnhancedTx`) — has `accountData[].tokenBalanceChanges` and
 *     `tokenTransfers`, but NO program logs, so Anchor events need a follow-up `getTransaction` (ingest.ts).
 *  2. Helius "raw" webhook items / RPC `getTransaction` (json encoding) (`RawRpcTx`).
 *  3. RPC `getParsedTransaction(s)` (jsonParsed encoding) used by the backfill (`ParsedRpcTx`).
 *
 * // CHECK vs Helius docs (https://docs.helius.dev/webhooks-and-websockets/webhooks): the enhanced payload
 * // field names below (`accountData[].tokenBalanceChanges[].rawTokenAmount.tokenAmount` as a SIGNED integer
 * // string, `tokenTransfers[].tokenAmount` as a UI float) were transcribed from the docs; not verified
 * // against a live delivery in this sandbox (no network).
 */

// ---- Helius enhanced ---------------------------------------------------------------------------

export interface HeliusTokenBalanceChange {
  userAccount: string; // token-account owner (wallet)
  tokenAccount: string;
  mint: string;
  rawTokenAmount: { tokenAmount: string; decimals: number }; // signed delta, base units
}

export interface HeliusAccountData {
  account: string;
  nativeBalanceChange?: number;
  tokenBalanceChanges?: HeliusTokenBalanceChange[];
}

export interface HeliusTokenTransfer {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  fromTokenAccount: string | null;
  toTokenAccount: string | null;
  tokenAmount: number; // UI units
  mint: string;
  decimals?: number;
}

export interface HeliusInstruction {
  programId: string;
  data: string;
  accounts: string[];
  innerInstructions?: HeliusInstruction[];
}

export interface HeliusEnhancedTx {
  signature: string;
  slot: number;
  timestamp: number;
  type?: string;
  source?: string;
  feePayer?: string;
  transactionError?: unknown;
  accountData?: HeliusAccountData[];
  tokenTransfers?: HeliusTokenTransfer[];
  instructions?: HeliusInstruction[];
  events?: Record<string, unknown>;
}

// ---- RPC json (Helius "raw" webhook / getTransaction) --------------------------------------------

export interface RpcTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface RpcCompiledInstruction {
  programIdIndex: number;
  accounts: number[];
  data: string;
}

export interface RawRpcTx {
  slot: number;
  blockTime?: number | null;
  meta: {
    err: unknown;
    logMessages?: string[] | null;
    preTokenBalances?: RpcTokenBalance[] | null;
    postTokenBalances?: RpcTokenBalance[] | null;
    innerInstructions?: { index: number; instructions: RpcCompiledInstruction[] }[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  } | null;
  transaction: {
    signatures: string[];
    message: { accountKeys: string[]; instructions: RpcCompiledInstruction[] };
  };
}

// ---- RPC jsonParsed (getParsedTransactions) ------------------------------------------------------

/** `PublicKey`-like (web3.js returns PublicKey objects; raw JSON returns strings). */
export type KeyLike = string | { toBase58(): string };

export interface ParsedRpcInstruction {
  programId: KeyLike;
}

export interface ParsedRpcTx {
  slot: number;
  blockTime?: number | null;
  meta: {
    err: unknown;
    logMessages?: string[] | null;
    preTokenBalances?: RpcTokenBalance[] | null;
    postTokenBalances?: RpcTokenBalance[] | null;
    innerInstructions?: { index: number; instructions: ParsedRpcInstruction[] }[] | null;
  } | null;
  transaction: {
    signatures: string[];
    message: { accountKeys: { pubkey: KeyLike; signer?: boolean }[]; instructions: ParsedRpcInstruction[] };
  };
}

// ---- normalized --------------------------------------------------------------------------------

/** Net change of one token account inside one transaction (base units, signed). */
export interface TokenDelta {
  tokenAccount: string;
  owner: string;
  mint: string;
  delta: bigint;
  decimals: number;
}

export interface NormalizedTx {
  signature: string;
  slot: number;
  /** unix seconds (block time; falls back to ingest time when the source omits it). */
  blockTime: number;
  feePayer: string;
  failed: boolean;
  /** Program ids invoked (outer + inner) — used to decide which decoders run. */
  programIds: Set<string>;
  /** Program log lines, or null when the source did not carry them (Helius enhanced). */
  logs: string[] | null;
  tokenDeltas: TokenDelta[];
}
