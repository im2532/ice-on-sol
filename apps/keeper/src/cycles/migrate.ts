/**
 * Migration cycle: polls DBC pools whose bonding curve has completed and aren't migrated
 * yet, runs `dbc.migrateToDammV2`, then calls `fee_router.record_migration` (keeper/admin only,
 * CONTRACTS §6). Per docs/research/02: "For GOLD, run your own migration keeper" since Meteora's
 * auto-migration only covers SOL/USDC/JUP quotes.
 *
 * The DAMM pool + position are discovered from the partner position NFT the migration mints to the
 * router PDA (see ../positions.ts) — the DBC pool state does not store the DAMM pool address.
 * `record_migration` accounts = camelCase of `RecordMigration` in
 * programs/fee_router/src/instructions/record_migration.rs.
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { feeRouter as feeRouterPda, getPoolState, makeDbcClient, migrateToDammV2Ixs } from "@icemarkets/sdk";
import { getConnection, getKeeperKeypair, sendWithPriority } from "../rpc";
import { getProgram, programId } from "../programs";
import { findRouterPositions, type RouterPosition } from "../positions";
import { listAllPools, listUnmigratedPools, markPoolMigrated, type PoolRow } from "../db";
import { childLogger } from "../logger";

const log = childLogger("migrate");

export async function runMigrateCycle(): Promise<void> {
  const connection = getConnection();
  const keeper = getKeeperKeypair();
  const dbcClient = makeDbcClient({ connection });

  const pools = await listUnmigratedPools();
  for (const pool of pools) {
    try {
      // CHECK vs SDK: getPoolState field names for curve-complete / is_migrated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = (await getPoolState(dbcClient, new PublicKey(pool.dbc_pool))) as any;
      const isMigrated = Boolean(Number(state?.isMigrated ?? state?.is_migrated ?? 0));
      const curveComplete = Boolean(state?.curveComplete ?? state?.isCurveComplete ?? false);

      if (!isMigrated) {
        if (!curveComplete) continue;
        log.info({ pool: pool.dbc_pool }, "migrating pool to DAMM v2");
        const migrateIxs = await migrateToDammV2Ixs({ client: dbcClient, pool: new PublicKey(pool.dbc_pool), payer: keeper.publicKey });
        await sendWithPriority(migrateIxs);
      }

      const pos = await findNewPosition(pool);
      if (!pos) {
        log.warn({ pool: pool.dbc_pool }, "migrated but no unrecorded router-owned DAMM position found; will retry record_migration next cycle");
        continue;
      }

      const dbcPool = new PublicKey(pool.dbc_pool);
      const fr = programId("fee_router");
      const recordIx: TransactionInstruction = await getProgram("fee_router")
        .methods.recordMigration(false)
        .accountsPartial({
          authority: keeper.publicKey,
          config: feeRouterPda.router(fr)[0],
          poolState: feeRouterPda.pool(fr, dbcPool)[0],
          dbcPool,
          dammPool: pos.pool,
          dammPosition: pos.position,
          positionNftAccount: pos.nftAccount,
        })
        .instruction();
      await sendWithPriority([recordIx]);
      await markPoolMigrated(pool.dbc_pool, pos.pool.toBase58());
      log.info({ pool: pool.dbc_pool, dammPool: pos.pool.toBase58() }, "migration recorded");
    } catch (err) {
      log.error({ pool: pool.dbc_pool, err: String(err) }, "migration cycle failed for pool");
    }
  }
}

/**
 * The router position for this pool = a router-owned position whose DAMM pool is not yet recorded
 * for any other pool. CHECK: if several pools migrate in the same cycle this picks the first
 * unrecorded one; tighten by checking the DAMM pool's token mints once the cp-amm layout is verified.
 */
async function findNewPosition(pool: PoolRow): Promise<RouterPosition | null> {
  const known = new Set((await listAllPools()).map((p) => p.damm_pool).filter((x): x is string => !!x));
  const candidates = (await findRouterPositions()).filter((p) => !known.has(p.pool.toBase58()));
  if (candidates.length > 1) log.warn({ pool: pool.dbc_pool, n: candidates.length }, "multiple unrecorded router positions; picking first");
  return candidates[0] ?? null;
}
