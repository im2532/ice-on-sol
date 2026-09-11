/**
 * distributor `claim` builder used client-side (rewards page). Hand-encoded — no IDL needed in the
 * browser — against programs/distributor/src/instructions/claim.rs. Account ORDER is the Rust `Claim`
 * struct field order; discriminator = sha256("global:claim")[..8].
 *
 * Keeper-side calls (open_epoch / push_payouts / finalize_epoch) use Anchor `Program<any>` +
 * target/idl/distributor.json in apps/keeper.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM_IDS } from "@icemarkets/registry";
import { ASSOCIATED_TOKEN_PROGRAM, TOKEN_PROGRAM, ata, distributor as distributorPda } from "./pda";

export const DISTRIBUTOR_PROGRAM_ID = new PublicKey(PROGRAM_IDS.distributor);

/** sha256("global:claim")[..8] */
export const CLAIM_DISCRIMINATOR = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);

export interface ClaimIxParams {
  wallet: PublicKey;
  /** DBC pool key the epoch belongs to (Epoch seed). */
  pool: PublicKey;
  epochIndex: number;
  /** COIN mint paid by this epoch (Epoch.coin_mint). */
  coinMint: PublicKey;
  /** Base units, exactly as in the Merkle leaf. */
  amount: bigint;
  /** Sibling hashes (32 bytes each), leaf → root. */
  proof: (Buffer | Uint8Array)[];
  tokenProgram?: PublicKey;
}

/** `claim(amount: u64, proof: Vec<[u8; 32]>)` — wallet pays rent for `Claimed` and (if needed) its ATA. */
export function claimIx(p: ClaimIxParams, programId: PublicKey = DISTRIBUTOR_PROGRAM_ID): TransactionInstruction {
  const tp = p.tokenProgram ?? TOKEN_PROGRAM;
  const epoch = distributorPda.epoch(programId, p.pool, p.epochIndex)[0];
  const data = Buffer.alloc(8 + 8 + 4 + 32 * p.proof.length);
  CLAIM_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(p.amount, 8);
  data.writeUInt32LE(p.proof.length, 16);
  p.proof.forEach((h, i) => {
    if (h.length !== 32) throw new Error("claimIx: proof element must be 32 bytes");
    Buffer.from(h).copy(data, 20 + 32 * i);
  });
  const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
  const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: p.wallet, isSigner: true, isWritable: true }, // wallet
      r(distributorPda.config(programId)[0]), // dist_config
      w(epoch), // epoch
      w(distributorPda.claimed(programId, epoch, p.wallet)[0]), // claimed (init)
      r(p.coinMint), // coin_mint
      w(distributorPda.epochVault(epoch, p.coinMint, tp)), // epoch_vault
      w(ata(p.coinMint, p.wallet, tp)), // wallet_ata (init_if_needed)
      r(tp), // token_program
      r(ASSOCIATED_TOKEN_PROGRAM), // associated_token_program
      r(SystemProgram.programId), // system_program
    ],
    data,
  });
}
