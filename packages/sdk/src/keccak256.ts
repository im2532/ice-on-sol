/**
 * Minimal, dependency-free Keccak-256 (NOT SHA3-256 — no 0x06 padding byte, uses the
 * original Keccak 0x01 domain separator) implemented directly from the keccak-f[1600]
 * permutation, matching Ethereum/Solidity `keccak256` and the hash most on-chain Merkle
 * distributors (incl. this one) use for leaves.
 *
 * Vendored instead of pulling `@noble/hashes` so this file has zero runtime dependencies
 * and typechecks/runs in a sandbox with no network access. If `@noble/hashes/sha3` is
 * available in the real build, prefer it (`keccak_256`) — this is a drop-in-compatible
 * fallback with the same output for the same input bytes.
 *
 * Reference: https://keccak.team/keccak_specs_summary.html (rate=1088 bits / 136 bytes,
 * capacity=512 bits for the 256-bit variant; 24 rounds; 1600-bit state as 25 lanes of u64).
 */

const ROUNDS = 24;
const RATE_BYTES = 136; // (1600 - 2*256) / 8

const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROT: number[] = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

const MASK64 = (1n << 64n) - 1n;

function rotl64(x: bigint, n: number): bigint {
  if (n === 0) return x & MASK64;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;
}

function keccakF1600(state: BigUint64Array): void {
  const B = new BigUint64Array(25);
  const C = new BigUint64Array(5);
  const D = new BigUint64Array(5);

  for (let round = 0; round < ROUNDS; round++) {
    // theta
    for (let x = 0; x < 5; x++) {
      C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] ^= D[x];
      }
    }
    // rho + pi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const newX = y;
        const newY = (2 * x + 3 * y) % 5;
        B[newX + 5 * newY] = rotl64(state[x + 5 * y], ROT[x + 5 * y]);
      }
    }
    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & B[(x + 2) % 5 + 5 * y]);
      }
    }
    // iota
    state[0] ^= RC[round];
  }
}

/** Keccak-256 over an arbitrary byte buffer. Returns a 32-byte Buffer. */
export function keccak256(input: Uint8Array): Buffer {
  const state = new BigUint64Array(25);

  // Pad with the Keccak (not SHA3) domain separator 0x01, then 0x80 at the end of the block.
  const blockLen = RATE_BYTES;
  const numBlocks = Math.floor(input.length / blockLen) + 1;
  const padded = new Uint8Array(numBlocks * blockLen);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  for (let offset = 0; offset < padded.length; offset += blockLen) {
    for (let i = 0; i < blockLen / 8; i++) {
      state[i] ^= view.getBigUint64(offset + i * 8, true);
    }
    keccakF1600(state);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    out.writeBigUInt64LE(state[i] & MASK64, i * 8);
  }
  return out;
}
