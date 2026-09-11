/**
 * fee_router instruction builders used client-side (launch flow). Hand-encoded — no IDL needed in the
 * browser — against programs/fee_router/src/instructions/register_pool.rs. Account ORDER below is the
 * Rust `RegisterPool` struct field order; discriminator = sha256("global:register_pool")[..8]
 * (checked by `scripts/print-discriminators.ts --check`).
 *
 * Keeper-side fee_router calls (claim_dbc / claim_damm / record_migration) go through Anchor
 * `Program<any>` + target/idl/fee_router.json in apps/keeper instead.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM_IDS } from "@icemarkets/registry";
import { ASSOCIATED_TOKEN_PROGRAM, TOKEN_PROGRAM, feeRouter as feeRouterPda } from "./pda";

export const FEE_ROUTER_PROGRAM_ID = new PublicKey(PROGRAM_IDS.feeRouter);

/** sha256("global:register_pool")[..8] */
export const REGISTER_POOL_DISCRIMINATOR = Buffer.from([85, 229, 114, 47, 75, 145, 166, 100]);

export interface RegisterPoolAccounts {
  payer: PublicKey;
  dbcPool: PublicKey;
  dbcConfig: PublicKey;
  /** peg_desk Commodity PDA whose coin_mint == quoteMint. */
  commodity: PublicKey;
  baseMint: PublicKey;
  /** COIN mint. */
  quoteMint: PublicKey;
  baseTokenProgram?: PublicKey;
  quoteTokenProgram?: PublicKey;
}

/** `register_pool(fee_bps: u16)` — permissionless; creates PoolState + holder_vault (+ buyback/treasury vaults if new). */
export function registerPoolIx(a: RegisterPoolAccounts, feeBps: number, programId: PublicKey = FEE_ROUTER_PROGRAM_ID): TransactionInstruction {
  const baseTp = a.baseTokenProgram ?? TOKEN_PROGRAM;
  const quoteTp = a.quoteTokenProgram ?? TOKEN_PROGRAM;
  const router = feeRouterPda.router(programId)[0];
  const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
  const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
  const data = Buffer.alloc(10);
  REGISTER_POOL_DISCRIMINATOR.copy(data, 0);
  data.writeUInt16LE(feeBps, 8);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: a.payer, isSigner: true, isWritable: true }, // payer
      r(router), // config
      r(a.dbcPool), // dbc_pool
      r(a.dbcConfig), // dbc_config
      r(a.commodity), // commodity
      r(a.baseMint), // base_mint
      r(a.quoteMint), // quote_mint
      w(feeRouterPda.pool(programId, a.dbcPool)[0]), // pool_state (init)
      w(feeRouterPda.holderVault(programId, a.dbcPool)[0]), // holder_vault (init)
      w(feeRouterPda.buybackVault(programId, a.quoteMint)[0]), // buyback_vault (init_if_needed)
      w(feeRouterPda.treasury(programId, a.quoteMint)[0]), // treasury_quote (init_if_needed)
      w(feeRouterPda.treasury(programId, a.baseMint)[0]), // treasury_base (init_if_needed)
      w(feeRouterPda.routerQuoteRecv(programId, a.quoteMint, quoteTp)), // router_quote_recv (init_if_needed ATA)
      r(baseTp), // base_token_program
      r(quoteTp), // quote_token_program
      r(ASSOCIATED_TOKEN_PROGRAM), // associated_token_program
      r(SystemProgram.programId), // system_program
    ],
    data,
  });
}
