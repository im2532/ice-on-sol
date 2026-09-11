/**
 * Normalizes the three accepted transaction shapes (types.ts) into `NormalizedTx`. Pure — no I/O.
 */
import type {
  HeliusEnhancedTx,
  HeliusInstruction,
  KeyLike,
  NormalizedTx,
  ParsedRpcTx,
  RawRpcTx,
  RpcTokenBalance,
  TokenDelta,
} from "./types";

const INVOKE_RE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/;

const keyStr = (k: KeyLike): string => (typeof k === "string" ? k : k.toBase58());

/** Program ids that appear as `Program <id> invoke [n]` in the logs. */
export function programIdsFromLogs(logs: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const line of logs) {
    const m = INVOKE_RE.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

export function isHeliusEnhanced(x: unknown): x is HeliusEnhancedTx {
  return typeof x === "object" && x !== null && typeof (x as { signature?: unknown }).signature === "string" && !("transaction" in x);
}

export function isRawRpc(x: unknown): x is RawRpcTx {
  if (typeof x !== "object" || x === null || !("transaction" in x) || !("meta" in x)) return false;
  const keys = (x as RawRpcTx).transaction?.message?.accountKeys;
  return Array.isArray(keys) && (keys.length === 0 || typeof keys[0] === "string");
}

// ---- Helius enhanced ---------------------------------------------------------------------------

export function fromHeliusEnhanced(tx: HeliusEnhancedTx): NormalizedTx {
  const programIds = new Set<string>();
  const walk = (ixs: HeliusInstruction[] | undefined) => {
    for (const ix of ixs ?? []) {
      programIds.add(ix.programId);
      walk(ix.innerInstructions);
    }
  };
  walk(tx.instructions);

  const deltas = new Map<string, TokenDelta>();
  for (const acc of tx.accountData ?? []) {
    for (const ch of acc.tokenBalanceChanges ?? []) {
      const raw = parseSignedBigInt(ch.rawTokenAmount?.tokenAmount);
      if (raw === null || raw === 0n) continue;
      addDelta(deltas, { tokenAccount: ch.tokenAccount, owner: ch.userAccount, mint: ch.mint, delta: raw, decimals: ch.rawTokenAmount.decimals });
    }
  }
  // Fallback when accountData carries no token changes: rebuild deltas from tokenTransfers (UI floats,
  // converted with the transfer's decimals — every ICEmarkets-relevant mint has 6).
  if (deltas.size === 0) {
    for (const t of tx.tokenTransfers ?? []) {
      const decimals = t.decimals ?? 6;
      const raw = BigInt(Math.round(t.tokenAmount * 10 ** decimals));
      if (raw === 0n) continue;
      if (t.fromTokenAccount) addDelta(deltas, { tokenAccount: t.fromTokenAccount, owner: t.fromUserAccount ?? "", mint: t.mint, delta: -raw, decimals });
      if (t.toTokenAccount) addDelta(deltas, { tokenAccount: t.toTokenAccount, owner: t.toUserAccount ?? "", mint: t.mint, delta: raw, decimals });
    }
  }

  return {
    signature: tx.signature,
    slot: tx.slot,
    blockTime: tx.timestamp || Math.floor(Date.now() / 1000),
    feePayer: tx.feePayer ?? "",
    failed: tx.transactionError != null,
    programIds,
    logs: null,
    tokenDeltas: [...deltas.values()],
  };
}

// ---- RPC json -----------------------------------------------------------------------------------

export function fromRawRpc(tx: RawRpcTx): NormalizedTx {
  const meta = tx.meta;
  const keys = [
    ...tx.transaction.message.accountKeys,
    ...(meta?.loadedAddresses?.writable ?? []),
    ...(meta?.loadedAddresses?.readonly ?? []),
  ];
  const logs = meta?.logMessages ?? null;
  const programIds = logs ? programIdsFromLogs(logs) : new Set<string>();
  for (const ix of tx.transaction.message.instructions) if (keys[ix.programIdIndex]) programIds.add(keys[ix.programIdIndex]);
  for (const inner of meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) if (keys[ix.programIdIndex]) programIds.add(keys[ix.programIdIndex]);
  }
  return {
    signature: tx.transaction.signatures[0],
    slot: tx.slot,
    blockTime: tx.blockTime ?? Math.floor(Date.now() / 1000),
    feePayer: keys[0] ?? "",
    failed: meta?.err != null,
    programIds,
    logs,
    tokenDeltas: diffTokenBalances(keys, meta?.preTokenBalances ?? [], meta?.postTokenBalances ?? []),
  };
}

// ---- RPC jsonParsed -----------------------------------------------------------------------------

export function fromParsedRpc(tx: ParsedRpcTx): NormalizedTx {
  const meta = tx.meta;
  // jsonParsed `accountKeys` already includes lookup-table-loaded keys (source: "lookupTable").
  const keys = tx.transaction.message.accountKeys.map((k) => keyStr(k.pubkey));
  const logs = meta?.logMessages ?? null;
  const programIds = logs ? programIdsFromLogs(logs) : new Set<string>();
  for (const ix of tx.transaction.message.instructions) programIds.add(keyStr(ix.programId));
  for (const inner of meta?.innerInstructions ?? []) for (const ix of inner.instructions) programIds.add(keyStr(ix.programId));
  return {
    signature: tx.transaction.signatures[0],
    slot: tx.slot,
    blockTime: tx.blockTime ?? Math.floor(Date.now() / 1000),
    feePayer: keys[0] ?? "",
    failed: meta?.err != null,
    programIds,
    logs,
    tokenDeltas: diffTokenBalances(keys, meta?.preTokenBalances ?? [], meta?.postTokenBalances ?? []),
  };
}

/** post − pre per token account (a missing pre = created in this tx, a missing post = closed). */
export function diffTokenBalances(keys: readonly string[], pre: readonly RpcTokenBalance[], post: readonly RpcTokenBalance[]): TokenDelta[] {
  const byIndex = new Map<number, { mint: string; owner: string; decimals: number; pre: bigint; post: bigint }>();
  const touch = (b: RpcTokenBalance) => {
    let e = byIndex.get(b.accountIndex);
    if (!e) {
      e = { mint: b.mint, owner: b.owner ?? "", decimals: b.uiTokenAmount.decimals, pre: 0n, post: 0n };
      byIndex.set(b.accountIndex, e);
    }
    if (!e.owner && b.owner) e.owner = b.owner;
    return e;
  };
  for (const b of pre) touch(b).pre = BigInt(b.uiTokenAmount.amount);
  for (const b of post) touch(b).post = BigInt(b.uiTokenAmount.amount);
  const out: TokenDelta[] = [];
  for (const [index, e] of byIndex) {
    const delta = e.post - e.pre;
    if (delta === 0n) continue;
    out.push({ tokenAccount: keys[index] ?? `#${index}`, owner: e.owner, mint: e.mint, delta, decimals: e.decimals });
  }
  return out;
}

// ---- helpers ------------------------------------------------------------------------------------

function addDelta(map: Map<string, TokenDelta>, d: TokenDelta): void {
  const k = `${d.tokenAccount}:${d.mint}`;
  const prev = map.get(k);
  if (prev) {
    prev.delta += d.delta;
    if (!prev.owner && d.owner) prev.owner = d.owner;
  } else {
    map.set(k, { ...d });
  }
}

function parseSignedBigInt(s: string | undefined): bigint | null {
  if (typeof s !== "string" || !/^-?\d+$/.test(s.trim())) return null;
  return BigInt(s.trim());
}
