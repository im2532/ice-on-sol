/**
 * Re-export shim. The single Merkle implementation lives in packages/sdk/src/merkle.ts
 * (shared with apps/keeper and apps/web) and must match programs/distributor/src/merkle.rs:
 *   leaf   = keccak256(epoch_pubkey(32) || wallet(32) || amount_u64_le(8))
 *   parent = keccak256(min(a, b) || max(a, b))
 * Imported by relative path (not "@icemarkets/sdk") so ts-mocha needs no tsconfig-paths and the
 * tests don't pull in the SDK's Meteora/Pyth dependencies.
 */
export {
  buildEpochTree as buildTree,
  getProof,
  getProofForWallet,
  hashPair,
  keyBytes,
  leafHash,
  proofToArgs,
  toArray32,
  toU64,
  verifyProof,
  type AmountLike,
  type EpochMerkleTree as MerkleTree,
  type KeyLike,
  type MerkleEntry,
} from "../packages/sdk/src/merkle";
export { keccak256 } from "../packages/sdk/src/keccak256";
