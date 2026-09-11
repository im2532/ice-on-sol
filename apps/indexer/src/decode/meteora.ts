/**
 * Meteora PDAs the indexer needs to recognise pool token vaults, plus the Metaplex metadata decoder used
 * to fill `pools.ticker/name/image_uri` at PoolRegistered time.
 *
 * Kept local (instead of importing @icemarkets/sdk, which drags in the Meteora/Anchor client SDKs) —
 * the seeds MUST stay identical to packages/sdk/src/meteora.ts:
 *   DBC / DAMM v2 token vault = PDA["token_vault", mint, pool]      // CHECK vs IDLs (same CHECK as sdk/meteora.ts)
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "@icemarkets/registry";

const DBC_ID = new PublicKey(process.env.DBC_PROGRAM_ID ?? PROGRAM_IDS.dbc);
const DAMM_ID = new PublicKey(process.env.DAMM_V2_PROGRAM_ID ?? PROGRAM_IDS.dammV2);
const METAPLEX_ID = new PublicKey(PROGRAM_IDS.tokenMetadata);

const pda = (seeds: Buffer[], program: PublicKey): string => PublicKey.findProgramAddressSync(seeds, program)[0].toBase58();

export function dbcTokenVault(mint: string, pool: string): string {
  return pda([Buffer.from("token_vault"), new PublicKey(mint).toBuffer(), new PublicKey(pool).toBuffer()], DBC_ID);
}

export function dammTokenVault(mint: string, pool: string): string {
  return pda([Buffer.from("token_vault"), new PublicKey(mint).toBuffer(), new PublicKey(pool).toBuffer()], DAMM_ID);
}

export function metadataPda(mint: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX_ID.toBuffer(), new PublicKey(mint).toBuffer()], METAPLEX_ID)[0];
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  uri: string;
}

/**
 * Metaplex Token Metadata v1 `Metadata` prefix: key u8 | update_authority [32] | mint [32] |
 * name (u32 len + bytes, NUL-padded to 32) | symbol (len + bytes, ≤10) | uri (len + bytes, ≤200).
 * This prefix has been stable since v1.0.
 */
export function decodeMetadata(data: Uint8Array): TokenMetadata {
  const buf = Buffer.from(data);
  let o = 1 + 32 + 32;
  const str = (): string => {
    if (o + 4 > buf.length) throw new Error("metadata: truncated");
    const len = buf.readUInt32LE(o);
    o += 4;
    if (len > 1024 || o + len > buf.length) throw new Error("metadata: bad string length");
    const s = buf.subarray(o, o + len).toString("utf8");
    o += len;
    return s.replace(/\0+$/g, "").trim();
  };
  const name = str();
  const symbol = str();
  const uri = str();
  return { name, symbol, uri };
}

/** Best-effort metadata fetch; null when RPC is not configured or the account is missing/unparseable. */
export async function fetchTokenMetadata(connection: Connection | null, mint: string): Promise<TokenMetadata | null> {
  if (!connection) return null;
  try {
    const info = await connection.getAccountInfo(metadataPda(mint), "confirmed");
    if (!info || !info.owner.equals(METAPLEX_ID)) return null;
    return decodeMetadata(info.data);
  } catch {
    return null;
  }
}
