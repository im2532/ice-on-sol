/**
 * PDA derivations for every ICEmarkets program. Seeds must match each program's
 * `src/constants.rs` exactly — see docs/CONTRACTS.md and
 * packages/registry/src/programs.ts (`SEEDS`, `PROGRAM_IDS`).
 *
 * All functions are pure and side-effect free; they take a `programId` so
 * callers (SDK, keeper, scripts, tests against a local validator) can point
 * at whichever cluster's deployed program id they're using.
 */
import { PublicKey } from "@solana/web3.js";
import { SEEDS } from "@icemarkets/registry";

/** Commodity symbols are stored on-chain as `[u8; 12]`, ASCII, NUL-padded on the right. */
export function symbolToBytes12(symbol: string): Buffer {
  if (!/^[A-Z0-9]{1,12}$/.test(symbol)) {
    throw new Error(`symbolToBytes12: "${symbol}" must be 1-12 uppercase alphanumeric chars`);
  }
  const buf = Buffer.alloc(12, 0);
  buf.write(symbol, "ascii");
  return buf;
}

/** SPL Token / Associated Token program ids (kept local so pda.ts only depends on web3.js). */
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Associated token address (same as spl-token `getAssociatedTokenAddressSync(mint, owner, true, tokenProgram)`). */
export function ata(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

function u32LE(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n >>> 0, 0);
  return buf;
}

// -----------------------------------------------------------------------
// peg_desk
// -----------------------------------------------------------------------
export const pegDesk = {
  config(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.pegDesk.config)], programId);
  },
  /** PDA["cmdty", symbol[12]] */
  commodity(programId: PublicKey, symbol: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.pegDesk.commodity), symbolToBytes12(symbol)],
      programId,
    );
  },
  /** PDA["reserve", commodity] — the USDC reserve TOKEN ACCOUNT itself (authority = commodity PDA; not an ATA). */
  reserve(programId: PublicKey, commodity: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.pegDesk.reserve), commodity.toBuffer()], programId);
  },
  /** PDA["hedge", commodity] — reserved for v1.1 `rebalance_hedge` (not created in MVP). */
  hedge(programId: PublicKey, commodity: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.pegDesk.hedge), commodity.toBuffer()], programId);
  },
  /** PDA["kp", commodity] — KeeperPrice account (KeeperSigned; also the Switchboard stand-in feed). */
  keeperPrice(programId: PublicKey, commodity: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.pegDesk.keeperPrice), commodity.toBuffer()], programId);
  },
  /** PDA["mint_auth"] — single mint authority PDA shared by every COIN mint. */
  mintAuth(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.pegDesk.mintAuth)], programId);
  },
};

// -----------------------------------------------------------------------
// fee_router
// -----------------------------------------------------------------------
export const feeRouter = {
  /** PDA["router"] — RouterConfig; also the signing authority: DBC config.fee_claimer and DAMM v2 position owner. */
  router(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.feeRouter.router)], programId);
  },
  /** PDA["pool", dbc_pool] — PoolState account for one DBC pool. */
  pool(programId: PublicKey, dbcPool: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.feeRouter.poolState), dbcPool.toBuffer()], programId);
  },
  /** PDA["holder_vault", dbc_pool] — the COIN TOKEN ACCOUNT itself (authority = PoolState PDA) holding the holders share. */
  holderVault(programId: PublicKey, dbcPool: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.feeRouter.holderVault), dbcPool.toBuffer()],
      programId,
    );
  },
  /** PDA["buyback_vault", coin_mint] — the COIN TOKEN ACCOUNT itself (authority = router PDA) holding the buyback share. */
  buybackVault(programId: PublicKey, coinMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.feeRouter.buybackVault), coinMint.toBuffer()],
      programId,
    );
  },
  /** PDA["treasury", mint] — the TOKEN ACCOUNT itself (authority = router PDA) for protocol share / base-token fees. */
  treasury(programId: PublicKey, coinMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.feeRouter.treasury), coinMint.toBuffer()], programId);
  },
  /** Router's receiving account for claimed COIN = ATA(mint, router PDA) (`router_quote_recv`). */
  routerQuoteRecv(programId: PublicKey, coinMint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM): PublicKey {
    return ata(coinMint, feeRouter.router(programId)[0], tokenProgram);
  },
};

// -----------------------------------------------------------------------
// distributor
// -----------------------------------------------------------------------
export const distributor = {
  /** PDA["dist"] — DistConfig singleton. */
  config(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.distributor.config)], programId);
  },
  /**
   * PDA["dist_auth"] — the distributor's CPI signer; fee_router `withdraw_for_epoch` only accepts
   * this PDA (derived from RouterConfig.distributor_program). Passed as `distAuth` to `open_epoch`.
   */
  distAuth(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.distributor.authority)], programId);
  },
  /** PDA["epoch", pool, epoch_index_u32_le] */
  epoch(programId: PublicKey, pool: PublicKey, index: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.distributor.epoch), pool.toBuffer(), u32LE(index)],
      programId,
    );
  },
  /** Epoch COIN vault = ATA(coin_mint, epoch PDA). */
  epochVault(epoch: PublicKey, coinMint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM): PublicKey {
    return ata(coinMint, epoch, tokenProgram);
  },
  /** PDA["claimed", epoch, wallet] */
  claimed(programId: PublicKey, epoch: PublicKey, wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.distributor.claimed), epoch.toBuffer(), wallet.toBuffer()],
      programId,
    );
  },
};

// -----------------------------------------------------------------------
// buyback
// -----------------------------------------------------------------------
export const buyback = {
  /** PDA["buyback"] — buyback program state singleton. */
  state(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.buyback.state)], programId);
  },
  /** PDA["bb_auth"] — buyback CPI signer accepted by fee_router `withdraw_for_buyback`; owns bb_gld / bb_icemarkets ATAs. */
  authority(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from(SEEDS.buyback.authority)], programId);
  },
};
