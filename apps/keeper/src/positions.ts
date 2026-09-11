/**
 * Discovers DAMM v2 positions owned by the fee_router router PDA (the DBC partner LP NFT lands there
 * at migration). Used by the migrate cycle (to find damm_pool / position for `record_migration`) and
 * the fees cycle (position NFT account for `claim_damm`).
 */
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DAMM_POSITION_POOL_OFFSET, DAMM_V2_PROGRAM_ID, feeRouter as feeRouterPda, meteora } from "@icemarkets/sdk";
import { getConnection } from "./rpc";
import { programId } from "./programs";

export interface RouterPosition {
  nftMint: PublicKey;
  /** Token-2022 account holding the NFT (owner = router PDA). */
  nftAccount: PublicKey;
  position: PublicKey;
  pool: PublicKey;
}

export async function findRouterPositions(): Promise<RouterPosition[]> {
  const conn = getConnection();
  const router = feeRouterPda.router(programId("fee_router"))[0];
  const res = await conn.getParsedTokenAccountsByOwner(router, { programId: TOKEN_2022_PROGRAM_ID });
  const nfts = res.value
    .map((a) => ({ account: a.pubkey, info: a.account.data.parsed?.info }))
    .filter((a) => a.info?.tokenAmount?.amount === "1" && a.info?.tokenAmount?.decimals === 0)
    .map((a) => ({ nftAccount: a.account, nftMint: new PublicKey(a.info.mint as string) }));
  if (nfts.length === 0) return [];
  const positions = nfts.map((n) => meteora.dammPosition(n.nftMint));
  const infos = await conn.getMultipleAccountsInfo(positions);
  const out: RouterPosition[] = [];
  nfts.forEach((n, i) => {
    const info = infos[i];
    if (!info || !info.owner.equals(DAMM_V2_PROGRAM_ID) || info.data.length < DAMM_POSITION_POOL_OFFSET + 32) return;
    const pool = new PublicKey(info.data.subarray(DAMM_POSITION_POOL_OFFSET, DAMM_POSITION_POOL_OFFSET + 32));
    out.push({ ...n, position: positions[i], pool });
  });
  return out;
}
