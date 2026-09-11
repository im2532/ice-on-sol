/**
 * THE Merkle implementation for `distributor.claim` — used by apps/keeper (payouts cycle),
 * tests/ (via the tests/merkle.ts re-export shim) and apps/web. Must match
 * programs/distributor/src/merkle.rs:
 *   leaf   = keccak256(epoch_pubkey(32) || wallet(32) || amount_u64_le(8))
 *   parent = keccak256(min(a, b) || max(a, b))          // sorted pair, bytewise compare
 *   an odd node at the end of a layer is carried up unchanged (one fewer proof element).
 *
 * Merkle tree for `distributor.claim` (docs/CONTRACTS.md §3): a sorted-pair keccak256
 * tree over `(epoch_pubkey, wallet, amount)` leaves, matching the on-chain check
 * `leaf = keccak(epoch, wallet, amount)` and the standard sorted-pair OpenZeppelin/Jito
 * style internal-node hashing (`hash(min(a,b) || max(a,b))`) so proof order doesn't
 * matter and the on-chain verifier can walk the proof without a left/right flag.
 *
 * Pure logic, zero runtime dependencies (no `@solana/web3.js` import) so it typechecks
 * and runs standalone. Callers pass 32-byte pubkeys as `Buffer`/`Uint8Array`
 * (`somePublicKey.toBuffer()` from `@solana/web3.js` works directly).
 */
import { keccak256 } from "./keccak256";

/** A 32-byte Solana pubkey, as raw bytes (`PublicKey.toBuffer()` / `.toBytes()`). */
export type Pubkey32 = Buffer | Uint8Array;

function toBuffer(bytes: Pubkey32): Buffer {
  if (bytes.length !== 32) throw new Error(`expected a 32-byte pubkey, got ${bytes.length} bytes`);
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

export interface MerkleLeafInput {
  epoch: Pubkey32;
  wallet: Pubkey32;
  /** Payout amount in COIN base units. */
  amount: bigint;
}

/** u64 little-endian, matching Anchor/Borsh's `u64` encoding on-chain. */
function u64LE(n: bigint): Buffer {
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error(`u64LE: out of range: ${n}`);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

/** leaf = keccak256(epoch_pubkey[32] || wallet[32] || amount_u64_le[8]) */
export function hashLeaf(input: MerkleLeafInput): Buffer {
  const preimage = Buffer.concat([toBuffer(input.epoch), toBuffer(input.wallet), u64LE(input.amount)]);
  return keccak256(preimage);
}

export function hashPair(a: Buffer, b: Buffer): Buffer {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return keccak256(Buffer.concat([lo, hi]));
}

export interface MerkleTree {
  /** Layer 0 is the leaves, last layer is `[root]`. */
  layers: Buffer[][];
  root: Buffer;
  leafCount: number;
}

/**
 * Builds a sorted-pair Merkle tree from precomputed leaf hashes (use `hashLeaf` to build
 * each one first, so callers control leaf ordering/dedup before hashing). An odd node at
 * any layer is carried up unchanged (duplicated-last-node style would let a leaf prove
 * itself twice; carrying up avoids that).
 */
export function buildTree(leaves: Buffer[]): MerkleTree {
  if (leaves.length === 0) throw new Error("buildTree: at least one leaf required");
  const layers: Buffer[][] = [leaves.slice()];
  let current = leaves;
  while (current.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        next.push(current[i]); // odd one out carries up
      }
    }
    layers.push(next);
    current = next;
  }
  return { layers, root: current[0], leafCount: leaves.length };
}

/** Convenience: build a tree directly from `(epoch, wallet, amount)` tuples. */
export function buildTreeFromInputs(inputs: MerkleLeafInput[]): MerkleTree & { leaves: Buffer[] } {
  const leaves = inputs.map(hashLeaf);
  return { ...buildTree(leaves), leaves };
}

/** Merkle proof for the leaf at `index`: sibling hashes from the leaf layer up to the root. */
export function getProof(tree: Pick<MerkleTree, "layers">, index: number): Buffer[] {
  const leafCount = tree.layers[0].length;
  if (index < 0 || index >= leafCount) {
    throw new Error(`getProof: index ${index} out of range [0, ${leafCount})`);
  }
  const proof: Buffer[] = [];
  let idx = index;
  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const nodes = tree.layers[layer];
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1;
    if (siblingIdx < nodes.length) {
      proof.push(nodes[siblingIdx]);
    }
    // if there's no sibling (odd node carried up), no proof element is added for this layer
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Verifies a leaf + proof reconstructs `root`, using the same sorted-pair rule as hashPair. */
export function verify(leaf: Buffer, proof: Buffer[], root: Buffer): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.equals(root);
}

/** Convenience: verify a `(epoch, wallet, amount)` tuple + proof against a root. */
export function verifyInput(input: MerkleLeafInput, proof: Buffer[], root: Buffer): boolean {
  return verify(hashLeaf(input), proof, root);
}

// ---------------------------------------------------------------------------------------------
// Epoch-scoped API (formerly tests/merkle.ts): one tree per distributor Epoch account.
// ---------------------------------------------------------------------------------------------

/** Anything with 32 raw bytes: web3.js PublicKey (`toBuffer`/`toBytes`) or a Uint8Array. */
export type KeyLike = Uint8Array | { toBuffer(): Buffer } | { toBytes(): Uint8Array };
/** bigint | number | BN (anything whose toString() is a base-10 integer). */
export type AmountLike = bigint | number | { toString(): string };

export interface MerkleEntry {
  wallet: KeyLike;
  amount: AmountLike;
}

export interface EpochMerkleTree extends MerkleTree {
  /** Normalised entries, same order as layers[0]. */
  entries: { wallet: Buffer; amount: bigint }[];
  /** Σ amounts — pass as `finalize_epoch(merkle_total)`. */
  total: bigint;
}

export function keyBytes(k: KeyLike): Buffer {
  let b: Uint8Array;
  if (k instanceof Uint8Array) b = k;
  else if ("toBuffer" in k) b = k.toBuffer();
  else b = k.toBytes();
  if (b.length !== 32) throw new Error(`expected 32-byte key, got ${b.length}`);
  return Buffer.from(b);
}

export function toU64(amount: AmountLike): bigint {
  const v = typeof amount === "bigint" ? amount : BigInt(amount.toString());
  if (v < 0n || v > 0xffffffffffffffffn) throw new Error(`amount out of u64 range: ${v}`);
  return v;
}

/** leaf for (epoch, wallet, amount) — alias of `hashLeaf` taking KeyLike/AmountLike. */
export function leafHash(epoch: KeyLike, wallet: KeyLike, amount: AmountLike): Buffer {
  return hashLeaf({ epoch: keyBytes(epoch), wallet: keyBytes(wallet), amount: toU64(amount) });
}

/** Builds the claim tree for one Epoch PDA. Rejects duplicate wallets (a wallet may claim once per epoch). */
export function buildEpochTree(epoch: KeyLike, entries: MerkleEntry[]): EpochMerkleTree {
  if (entries.length === 0) throw new Error("buildEpochTree: no entries");
  const norm = entries.map((e) => ({ wallet: keyBytes(e.wallet), amount: toU64(e.amount) }));
  const seen = new Set<string>();
  for (const e of norm) {
    const k = e.wallet.toString("hex");
    if (seen.has(k)) throw new Error(`buildEpochTree: duplicate wallet ${k}`);
    seen.add(k);
  }
  const tree = buildTree(norm.map((e) => leafHash(epoch, e.wallet, e.amount)));
  const total = norm.reduce((s, e) => s + e.amount, 0n);
  return { ...tree, entries: norm, total };
}

export function getProofForWallet(tree: EpochMerkleTree, wallet: KeyLike): { index: number; amount: bigint; proof: Buffer[] } {
  const w = keyBytes(wallet);
  const index = tree.entries.findIndex((e) => e.wallet.equals(w));
  if (index < 0) throw new Error("getProofForWallet: wallet not in tree");
  return { index, amount: tree.entries[index].amount, proof: getProof(tree, index) };
}

/** Same as `verify` with the merkle.rs argument order (proof, root, leaf). */
export function verifyProof(proof: Buffer[], root: Buffer, leaf: Buffer): boolean {
  return verify(leaf, proof, root);
}

/** Anchor arg encoding for `[u8; 32]` / `Vec<[u8; 32]>`. */
export const toArray32 = (b: Buffer): number[] => Array.from(b);
export const proofToArgs = (proof: Buffer[]): number[][] => proof.map(toArray32);
