/**
 * Payout cycle (docs/CONTRACTS.md §3, §5): for each pool whose fee_router `holder_vault` holds at
 * least `PAYOUT_MIN_POOL_USD` of COIN, compute memecoin TWAB from `balance_events`, then
 *   `distributor.open_epoch` (pulls the vault via fee_router `withdraw_for_epoch`)
 *   -> `push_payouts` (≤ 12 per tx, only to EXISTING COIN token accounts)
 *   -> `finalize_epoch` with the Merkle root of the remainder (leaves stored in `merkle_leaves`).
 *
 * On-chain facts this relies on (fee_router register_pool.rs / distributor open_epoch.rs):
 *  - holder_vault = PDA["holder_vault", dbc_pool] is itself a COIN (= pool.quote_mint) token account
 *    whose authority is PoolState PDA["pool", dbc_pool];
 *  - payouts are paid in COIN (Epoch.coin_mint = quote mint) to holders of the MEMECOIN (base mint);
 *  - the Merkle tree is the single SDK implementation (`buildEpochTree`, same as merkle.rs).
 */
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import {
  buildEpochTree,
  computeShares,
  computeTwab,
  getProof,
  distributor as distributorPda,
  feeRouter as feeRouterPda,
} from "@icemarkets/sdk";
import { loadConfig } from "../config";
import { getConnection, getKeeperKeypair, sendWithPriority } from "../rpc";
import { getProgram, programId } from "../programs";
import {
  getBalanceEvents,
  getBalanceEventsBefore,
  getLastEpoch,
  getLatestPrice,
  insertEpoch,
  insertMerkleLeaves,
  listAllPools,
  markEpochFinalized,
  recordPayout,
  type PoolRow,
} from "../db";
import { childLogger } from "../logger";

const log = childLogger("payouts");

/** distributor constants.rs MAX_PUSH_ITEMS (64-account lock limit). */
const PUSH_CHUNK_SIZE = 12;
const BPS = 10_000n;

/** Addresses never eligible for holder payouts (program-owned vaults / PDAs that may hold memecoin). */
function excludedAddresses(pool: PoolRow): Set<string> {
  const fr = programId("fee_router");
  const s = new Set<string>([
    pool.dbc_pool,
    feeRouterPda.router(fr)[0].toBase58(),
    feeRouterPda.pool(fr, new PublicKey(pool.dbc_pool))[0].toBase58(),
    "11111111111111111111111111111111", // CHECK: add the real burn / DBC & DAMM pool-authority owners once the indexer records owners
  ]);
  if (pool.damm_pool) s.add(pool.damm_pool);
  return s;
}

export async function runPayoutsCycle(): Promise<void> {
  const keeper = getKeeperKeypair();
  const pools = await listAllPools();
  for (const pool of pools) {
    try {
      await runPayoutsForPool(pool, keeper.publicKey);
    } catch (err) {
      log.error({ pool: pool.dbc_pool, err: String(err) }, "payout cycle failed for pool");
    }
  }
}

async function runPayoutsForPool(pool: PoolRow, keeperPubkey: PublicKey): Promise<void> {
  const cfg = loadConfig();
  const connection = getConnection();
  const dist = getProgram("distributor");
  const distId = programId("distributor");
  const frId = programId("fee_router");

  const dbcPool = new PublicKey(pool.dbc_pool);
  const coinMint = new PublicKey(pool.quote_mint);
  const holderVault = feeRouterPda.holderVault(frId, dbcPool)[0];
  const balance = await connection.getTokenAccountBalance(holderVault).catch(() => null);
  if (!balance?.value) return;
  const vaultBaseUnits = BigInt(balance.value.amount);
  if (vaultBaseUnits === 0n) return;

  // $ gate on the COIN value of the vault (COIN price = commodity oracle price).
  const priceRow = await getLatestPrice(pool.commodity);
  if (!priceRow) {
    log.warn({ pool: pool.dbc_pool, commodity: pool.commodity }, "no cached COIN price; skipping payout gate");
    return;
  }
  const vaultUsd = (Number(vaultBaseUnits) / 1e6) * (Number(priceRow.price) / 1e8);
  if (vaultUsd < cfg.payoutMinPoolUsd) return;

  const last = await getLastEpoch(pool.dbc_pool);
  const nowSec = Math.floor(Date.now() / 1000);
  const index = last ? last.index + 1 : 0;
  const startTs = last ? last.end_ts : nowSec - cfg.feeCycleIntervalSec;
  const endTs = nowSec;
  if (endTs <= startTs) return;

  const events = await getBalanceEvents(pool.dbc_pool, startTs, endTs);
  const priorEvents = await getBalanceEventsBefore(pool.dbc_pool, startTs);
  const allEvents = [...priorEvents, ...events].map((e) => ({ pool: e.pool, wallet: e.wallet, delta: BigInt(e.delta), ts: Number(e.ts) }));

  const twab = computeTwab(allEvents, { start: startTs, end: endTs, exclude: excludedAddresses(pool) });
  if (twab.size === 0) {
    log.debug({ pool: pool.dbc_pool }, "no eligible TWAB balances this epoch");
    return;
  }

  // CHECK: TWAB is in MEMECOIN units and there is no memecoin USD price feed yet, so the
  // PAYOUT_MIN_HOLDING_USD filter is disabled (every TWAB > 0 is eligible). Wire a memecoin price
  // (trades.price_usd or DBC curve price) into `minHoldingUsd/priceUsd8` before mainnet.
  const shares = computeShares(twab, vaultBaseUnits, { minHoldingUsd: 0, priceUsd8: 1n, coinDecimals: 0 });
  if (shares.size === 0) return;
  const twabTotal = [...twab.values()].reduce((a, b) => a + b, 0n);

  // ---- open_epoch (router mode) ------------------------------------------------------------
  const epoch = distributorPda.epoch(distId, dbcPool, index)[0];
  const epochVault = getAssociatedTokenAddressSync(coinMint, epoch, true);
  const distConfig = distributorPda.config(distId)[0];
  const routerConfig = feeRouterPda.router(frId)[0];
  const poolState = feeRouterPda.pool(frId, dbcPool)[0];

  log.info({ pool: pool.dbc_pool, index, holders: shares.size, total: vaultBaseUnits.toString() }, "opening epoch");
  const openIx: TransactionInstruction = await dist.methods
    .openEpoch({
      pool: dbcPool,
      index,
      startTs: new BN(startTs),
      endTs: new BN(endTs),
      totalAmount: new BN(vaultBaseUnits.toString()),
      eligibleHolders: shares.size,
      twabTotal: new BN(twabTotal.toString()),
    })
    .accountsPartial({
      keeper: keeperPubkey,
      distConfig,
      epoch,
      coinMint,
      epochVault,
      sourceVault: holderVault,
      sourceAuthority: poolState, // router mode: fee_router PoolState (not a signer)
      distAuth: distributorPda.distAuth(distId)[0],
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: frId, isSigner: false, isWritable: false }, // fee_router program (CPI target)
      { pubkey: routerConfig, isSigner: false, isWritable: false }, // fee_router RouterConfig
    ])
    .instruction();
  await sendWithPriority([openIx]);
  await insertEpoch({
    pool: pool.dbc_pool,
    index,
    coin_mint: coinMint.toBase58(),
    start_ts: startTs,
    end_ts: endTs,
    total_amount: vaultBaseUnits.toString(),
    eligible_holders: shares.size,
  });

  // ---- split: push (existing COIN token account, within max_push_per_epoch_bps) vs Merkle ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dc: any = await (dist.account as any).distConfig.fetch(distConfig);
  const pushCap = (vaultBaseUnits * BigInt(dc.maxPushPerEpochBps)) / BPS;

  const entries = [...shares.entries()].filter(([, amt]) => amt > 0n);
  const destAtas = entries.map(([wallet]) => getAssociatedTokenAddressSync(coinMint, new PublicKey(wallet), true));
  const infos = await connection.getMultipleAccountsInfo(destAtas);
  const pushable: { wallet: string; amount: bigint; dest: PublicKey }[] = [];
  const remainder: [string, bigint][] = [];
  let pushPlanned = 0n;
  entries.forEach(([wallet, amount], i) => {
    const info = infos[i];
    const existing = info !== null && info.owner.equals(TOKEN_PROGRAM_ID);
    if (existing && pushPlanned + amount <= pushCap) {
      pushable.push({ wallet, amount, dest: destAtas[i] });
      pushPlanned += amount;
    } else {
      remainder.push([wallet, amount]);
    }
  });

  let pushedTotal = 0n;
  for (let i = 0; i < pushable.length; i += PUSH_CHUNK_SIZE) {
    const chunk = pushable.slice(i, i + PUSH_CHUNK_SIZE);
    const pushIx: TransactionInstruction = await dist.methods
      .pushPayouts(chunk.map((c) => ({ wallet: new PublicKey(c.wallet), amount: new BN(c.amount.toString()) })))
      .accountsPartial({ keeper: keeperPubkey, distConfig, epoch, coinMint, epochVault, tokenProgram: TOKEN_PROGRAM_ID })
      .remainingAccounts(chunk.map((c) => ({ pubkey: c.dest, isSigner: false, isWritable: true })))
      .instruction();
    await sendWithPriority([pushIx]);
    for (const c of chunk) {
      await recordPayout({ pool: pool.dbc_pool, epoch_index: index, wallet: c.wallet, coin_mint: coinMint.toBase58(), amount: c.amount.toString(), kind: 0 });
      pushedTotal += c.amount;
    }
  }

  // ---- finalize_epoch: Merkle root over the remainder (zero root closes an all-push epoch) ----
  const tree = remainder.length > 0 ? buildEpochTree(epoch, remainder.map(([wallet, amount]) => ({ wallet: new PublicKey(wallet), amount }))) : null;
  const root = tree ? tree.root : Buffer.alloc(32);
  const merkleTotal = tree ? tree.total : 0n;
  const finalizeIx: TransactionInstruction = await dist.methods
    .finalizeEpoch(Array.from(root), new BN(merkleTotal.toString()))
    .accountsPartial({ keeper: keeperPubkey, distConfig, epoch })
    .instruction();
  await sendWithPriority([finalizeIx]);
  await markEpochFinalized(pool.dbc_pool, index, root.toString("hex"), pushedTotal.toString(), merkleTotal.toString());

  if (tree) {
    await insertMerkleLeaves(
      tree.entries.map((e, i) => ({
        pool: pool.dbc_pool,
        epoch_index: index,
        epoch_pubkey: epoch.toBase58(),
        wallet: new PublicKey(e.wallet).toBase58(),
        coin_mint: coinMint.toBase58(),
        amount: e.amount.toString(),
        proof: getProof(tree, i).map((b) => b.toString("hex")),
      })),
    );
  }
  log.info(
    { pool: pool.dbc_pool, index, pushed: pushedTotal.toString(), merkleTotal: merkleTotal.toString(), claimers: remainder.length },
    "epoch finalized",
  );
}
