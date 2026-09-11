/**
 * Meteora DBC / DAMM v2 PDA helpers used to assemble fee_router / buyback account lists.
 *
 * CHECK vs IDL / SDK (dbc rev f552f20, cp-amm rev a85c926) before devnet — the seeds below are the
 * ones used by both programs' Anchor constraints at those revisions:
 *   pool_authority   = PDA["pool_authority"]
 *   event_authority  = PDA["__event_authority"]            (Anchor #[event_cpi])
 *   token vault      = PDA["token_vault", mint, pool]
 *   DAMM position    = PDA["position", position_nft_mint]
 * Prefer addresses read from pool state (e.g. DBC `getPoolState().baseVault`) when available.
 */
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "@icemarkets/registry";

export const DAMM_V2_PROGRAM_ID = new PublicKey(PROGRAM_IDS.dammV2);
const DBC_ID = new PublicKey(PROGRAM_IDS.dbc);

const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];

export const meteora = {
  dbcPoolAuthority: (): PublicKey => pda([Buffer.from("pool_authority")], DBC_ID),
  dbcEventAuthority: (): PublicKey => pda([Buffer.from("__event_authority")], DBC_ID),
  dbcTokenVault: (mint: PublicKey, pool: PublicKey): PublicKey => pda([Buffer.from("token_vault"), mint.toBuffer(), pool.toBuffer()], DBC_ID),
  dammPoolAuthority: (): PublicKey => pda([Buffer.from("pool_authority")], DAMM_V2_PROGRAM_ID),
  dammEventAuthority: (): PublicKey => pda([Buffer.from("__event_authority")], DAMM_V2_PROGRAM_ID),
  dammTokenVault: (mint: PublicKey, pool: PublicKey): PublicKey =>
    pda([Buffer.from("token_vault"), mint.toBuffer(), pool.toBuffer()], DAMM_V2_PROGRAM_ID),
  dammPosition: (positionNftMint: PublicKey): PublicKey => pda([Buffer.from("position"), positionNftMint.toBuffer()], DAMM_V2_PROGRAM_ID),
};

/** fee_router constants.rs damm_layout: Position { disc(8), pool(32) @8, nft_mint(32) @40, … } — VERIFY OFFSET. */
export const DAMM_POSITION_POOL_OFFSET = 8;
export const DAMM_POSITION_NFT_MINT_OFFSET = 40;
