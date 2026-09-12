/**
 * fee_router `PoolState` scan — the source of truth for registered pools when the `PoolRegistered`
 * event is missing: Solana truncates transaction logs at 10 KB and the one-tx launch (peg_desk buy →
 * DBC pool init + Metaplex metadata → first swap → register_pool) overruns it, so the event emitted
 * last by `emit!` never reaches the log. (Durable fix tracked in MAINNET_PLAN: `emit_cpi!`.)
 * One PoolState per market, fetched with a discriminator memcmp filter — cheap at any scale we care about.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { idlDir, programIds } from "./anchorEvents";

export interface PoolStateView {
  poolState: string;
  dbcPool: string;
  dbcConfig: string;
  baseMint: string;
  quoteMint: string;
  commodity: string;
  creator: string;
  feeBps: number;
  migrated: boolean;
  dammPool: string;
}

let cached: { coder: BorshCoder; programId: PublicKey; discriminator: number[] } | null = null;
function feeRouter(): { coder: BorshCoder; programId: PublicKey; discriminator: number[] } {
  if (cached) return cached;
  const idl = JSON.parse(readFileSync(path.join(idlDir(), "fee_router.json"), "utf8")) as Idl & { accounts: { name: string; discriminator: number[] }[] };
  const programId = new PublicKey(programIds().fee_router);
  const acct = idl.accounts.find((a) => a.name === "PoolState");
  if (!acct) throw new Error("fee_router IDL has no PoolState account");
  cached = { coder: new BorshCoder({ ...idl, address: programId.toBase58() } as Idl), programId, discriminator: acct.discriminator };
  return cached;
}

export async function fetchAllPoolStates(connection: Connection): Promise<PoolStateView[]> {
  const { coder, programId, discriminator } = feeRouter();
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [{ memcmp: { offset: 0, bytes: bs58(discriminator) } }],
  });
  return accounts.map(({ pubkey, account }) => {
    // Anchor's account coder keeps the IDL's snake_case field names.
    const d = coder.accounts.decode("PoolState", account.data) as Record<string, unknown>;
    const pk = (v: unknown) => (v as PublicKey).toBase58();
    return {
      poolState: pubkey.toBase58(),
      dbcPool: pk(d.dbc_pool),
      dbcConfig: pk(d.dbc_config),
      baseMint: pk(d.base_mint),
      quoteMint: pk(d.quote_mint),
      commodity: pk(d.commodity),
      creator: pk(d.creator),
      feeBps: Number(d.fee_bps),
      migrated: Boolean(d.migrated),
      dammPool: pk(d.damm_pool),
    };
  });
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58(bytes: number[]): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
