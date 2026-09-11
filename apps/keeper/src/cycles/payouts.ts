/**
 * Payout cycle (docs/CONTRACTS.md §3, §5): for each pool whose fee_router `holder_vault` holds at
 * least `PAYOUT_MIN_POOL_USD` of COIN, compute memecoin TWAB from `balance_events`, then
 *   `distributor.open_epoch` (pulls the vault via fee_router `withdraw_for_epoch`)
 *   -> `push_payouts` (≤ 12 per tx, only to EXISTING COIN token accounts)
 *   -> `finalize_epoch` with the Merkle root of the remainder (leaves stored in `merkle_leaves`).
 *
 * RESUMABILITY (v0.2). Before opening a new epoch the cycle loads the pool's latest on-chain `Epoch`:
 *  - `!finalized` → RESUME it instead of opening `index + 1`: the share plan persisted in
 *    `epoch_progress` before `open_epoch` was sent is reloaded, wallets already pushed are taken from
 *    `payouts` (reconciled against the chain's `Payout` events when the db total disagrees with
 *    `Epoch.pushed_amount`), the rest is pushed/Merkle'd, and the epoch is finalized.
 *  - `finalized` but `epoch_progress.phase != 'finalized'` (crash after finalize) → rebuild the Merkle
 *    tree from plan − pushed, check it reproduces the on-chain root, and write `merkle_leaves`.
 * Only after that does the cycle open the next epoch. The plan is saved (phase 'planned') BEFORE
 * `open_epoch`, so a resumed epoch pays exactly the allocation it was opened with.
 *
 * MIN HOLDING (v0.2). TWAB is in memecoin units; the memecoin USD price is the latest candle close
 * (memecoin price in COIN, apps/indexer candles.ts) × the COIN USD price (`prices`). Wallets whose TWAB
 * is worth < `PAYOUT_MIN_HOLDING_USD` are dropped. Without a candle or COIN price the filter is skipped
 * with a warning (every TWAB > 0 stays eligible).
 *
 * On-chain facts this relies on (fee_router register_pool.rs / distributor *.rs):
 *  - holder_vault = PDA["holder_vault", dbc_pool] is a COIN (= pool.quote_mint) token account whose
 *    authority is PoolState PDA["pool", dbc_pool]; payouts are paid in COIN to MEMECOIN holders;
 *  - push_payouts: `sum ≤ total − pushed`, `pushed ≤ total × max_push_per_epoch_bps`, not finalized;
 *  - finalize_epoch: `merkle_total ≤ total − pushed`; leaf = keccak(epoch, wallet, amount) (sdk buildEpochTree).
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
  meteora,
} from "@icemarkets/sdk";
import { loadConfig } from "../config";
import { getConnection, getKeeperKeypair, sendWithPriority } from "../rpc";
import { getProgram, parseEvents, programId } from "../programs";
import {
  getBalanceEvents,
  getBalanceEventsBefore,
  getEpochProgress,
  getLatestCandleClose,
  getLatestPrice,
  getMaxKnownEpochIndex,
  getPushedPayouts,
  insertEpoch,
  insertMerkleLeaves,
  listAllPools,
  markEpochFinalized,
  recordPayout,
  saveEpochPlan,
  setEpochError,
  setEpochPhase,
  type EpochPlanItem,
  type PoolRow,
} from "../db";
import { childLogger } from "../logger";

const log = childLogger("payouts");

/** distributor constants.rs MAX_PUSH_ITEMS (64-account lock limit). */
const PUSH_CHUNK_SIZE = 12;
const BPS = 10_000n;
const ZERO_ROOT_HEX = "0".repeat(64);

// ---- on-chain Epoch account ---------------------------------------------------------------------

/** distributor `Epoch` (state.rs), as returned by Anchor's camelCased account coder. */
interface EpochAccount {
  pool: PublicKey;
  index: number;
  coinMint: PublicKey;
  startTs: number;
  endTs: number;
  totalAmount: bigint;
  pushedAmount: bigint;
  merkleRootHex: string;
  merkleTotal: bigint;
  finalized: boolean;
}

const big = (v: unknown): bigint => BigInt(String(v));

async function fetchEpoch(epoch: PublicKey): Promise<EpochAccount | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await (getProgram("distributor").account as any).epoch.fetchNullable(epoch);
  if (!raw) return null;
  return {
    pool: raw.pool,
    index: Number(raw.index),
    coinMint: raw.coinMint,
    startTs: Number(String(raw.startTs)),
    endTs: Number(String(raw.endTs)),
    totalAmount: big(raw.totalAmount),
    pushedAmount: big(raw.pushedAmount),
    merkleRootHex: Buffer.from(raw.merkleRoot as number[]).toString("hex"),
    merkleTotal: big(raw.merkleTotal),
    finalized: Boolean(raw.finalized),
  };
}

// ---- per-pool context -----------------------------------------------------------------------------

interface PoolCtx {
  pool: PoolRow;
  keeper: PublicKey;
  dbcPool: PublicKey;
  coinMint: PublicKey;
  distId: PublicKey;
  frId: PublicKey;
  holderVault: PublicKey;
  distConfig: PublicKey;
}

function poolCtx(pool: PoolRow, keeper: PublicKey): PoolCtx {
  const distId = programId("distributor");
  const frId = programId("fee_router");
  const dbcPool = new PublicKey(pool.dbc_pool);
  return {
    pool,
    keeper,
    dbcPool,
    coinMint: new PublicKey(pool.quote_mint),
    distId,
    frId,
    holderVault: feeRouterPda.holderVault(frId, dbcPool)[0],
    distConfig: distributorPda.config(distId)[0],
  };
}

const epochPdaFor = (ctx: PoolCtx, index: number): PublicKey => distributorPda.epoch(ctx.distId, ctx.dbcPool, index)[0];

/** Addresses never eligible for holder payouts (program-owned vaults / PDAs that may hold memecoin). */
function excludedAddresses(pool: PoolRow): Set<string> {
  const fr = programId("fee_router");
  const s = new Set<string>([
    pool.dbc_pool,
    feeRouterPda.router(fr)[0].toBase58(),
    feeRouterPda.pool(fr, new PublicKey(pool.dbc_pool))[0].toBase58(),
    meteora.dbcPoolAuthority().toBase58(), // owner of the DBC base vault
    meteora.dammPoolAuthority().toBase58(), // owner of the DAMM v2 vaults
    "11111111111111111111111111111111",
  ]);
  if (pool.damm_pool) s.add(pool.damm_pool);
  return s;
}

// ---- cycle ----------------------------------------------------------------------------------------

export async function runPayoutsCycle(): Promise<void> {
  const keeper = getKeeperKeypair();
  const pools = await listAllPools();
  for (const pool of pools) {
    try {
      await runPayoutsForPool(poolCtx(pool, keeper.publicKey));
    } catch (err) {
      log.error({ pool: pool.dbc_pool, err: String(err) }, "payout cycle failed for pool");
    }
  }
}

/**
 * The newest epoch that exists on-chain: start at the highest index the db knows, probe forward (an
 * `open_epoch` may have landed without the db write), and step back over a 'planned' index whose open
 * never landed.
 */
async function findLatestOnChainEpoch(ctx: PoolCtx): Promise<EpochAccount | null> {
  let idx = await getMaxKnownEpochIndex(ctx.pool.dbc_pool);
  for (;;) {
    const next = await fetchEpoch(epochPdaFor(ctx, idx + 1));
    if (!next) break;
    idx++;
  }
  for (let i = idx; i >= 0 && i >= idx - 2; i--) {
    const acc = await fetchEpoch(epochPdaFor(ctx, i));
    if (acc) return acc;
  }
  return null;
}

async function runPayoutsForPool(ctx: PoolCtx): Promise<void> {
  const { pool } = ctx;
  const latest = await findLatestOnChainEpoch(ctx);

  if (latest && !latest.finalized) {
    log.warn({ pool: pool.dbc_pool, index: latest.index, pushed: latest.pushedAmount.toString() }, "resuming unfinalized epoch");
    await resumeEpoch(ctx, latest);
    return; // open the next epoch on the next cycle
  }
  if (latest) {
    // Bookkeeping repair must not block new epochs (the on-chain epoch is already closed).
    await repairFinalizedBookkeeping(ctx, latest).catch(async (err: unknown) => {
      log.error({ pool: pool.dbc_pool, index: latest.index, err: String(err) }, "bookkeeping repair failed");
      await setEpochError(pool.dbc_pool, latest.index, String(err));
    });
  }

  await openNewEpoch(ctx, latest);
}

// ---- new epoch ------------------------------------------------------------------------------------

async function openNewEpoch(ctx: PoolCtx, latest: EpochAccount | null): Promise<void> {
  const cfg = loadConfig();
  const { pool } = ctx;
  const connection = getConnection();

  const balance = await connection.getTokenAccountBalance(ctx.holderVault).catch(() => null);
  if (!balance?.value) return;
  const vaultBaseUnits = BigInt(balance.value.amount);
  if (vaultBaseUnits === 0n) return;

  // $ gate on the COIN value of the vault (COIN price = commodity oracle price).
  const coinPrice = await getLatestPrice(pool.commodity);
  if (!coinPrice) {
    log.warn({ pool: pool.dbc_pool, commodity: pool.commodity }, "no cached COIN price; skipping payout gate");
    return;
  }
  const vaultUsd = (Number(vaultBaseUnits) / 1e6) * (Number(coinPrice.price) / 1e8);
  if (vaultUsd < cfg.payoutMinPoolUsd) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const index = latest ? latest.index + 1 : 0;
  const startTs = latest ? latest.endTs : nowSec - cfg.feeCycleIntervalSec;
  const endTs = nowSec;
  if (endTs <= startTs) return;

  const plan = await computePlan(ctx, startTs, endTs, vaultBaseUnits);
  if (!plan) return;

  const epoch = epochPdaFor(ctx, index);
  await saveEpochPlan({
    pool: pool.dbc_pool,
    epoch_index: index,
    epoch_pubkey: epoch.toBase58(),
    coin_mint: ctx.coinMint.toBase58(),
    start_ts: startTs,
    end_ts: endTs,
    total_amount: vaultBaseUnits,
    plan: plan.items,
  });

  log.info({ pool: pool.dbc_pool, index, holders: plan.items.length, total: vaultBaseUnits.toString() }, "opening epoch");
  const dist = getProgram("distributor");
  const openIx: TransactionInstruction = await dist.methods
    .openEpoch({
      pool: ctx.dbcPool,
      index,
      startTs: new BN(startTs),
      endTs: new BN(endTs),
      totalAmount: new BN(vaultBaseUnits.toString()),
      eligibleHolders: plan.items.length,
      twabTotal: new BN(plan.twabTotal.toString()),
    })
    .accountsPartial({
      keeper: ctx.keeper,
      distConfig: ctx.distConfig,
      epoch,
      coinMint: ctx.coinMint,
      epochVault: getAssociatedTokenAddressSync(ctx.coinMint, epoch, true),
      sourceVault: ctx.holderVault,
      sourceAuthority: feeRouterPda.pool(ctx.frId, ctx.dbcPool)[0], // router mode: fee_router PoolState (not a signer)
      distAuth: distributorPda.distAuth(ctx.distId)[0],
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: ctx.frId, isSigner: false, isWritable: false }, // fee_router program (CPI target)
      { pubkey: feeRouterPda.router(ctx.frId)[0], isSigner: false, isWritable: false }, // fee_router RouterConfig
    ])
    .instruction();
  const openSig = await sendWithPriority([openIx]);
  await setEpochPhase(pool.dbc_pool, index, "opened", { open_sig: openSig });
  await insertEpoch({
    pool: pool.dbc_pool,
    index,
    coin_mint: ctx.coinMint.toBase58(),
    start_ts: startTs,
    end_ts: endTs,
    total_amount: vaultBaseUnits.toString(),
    eligible_holders: plan.items.length,
    epoch_pubkey: epoch.toBase58(),
  });

  const acc = await fetchEpoch(epoch);
  if (!acc) throw new Error(`open_epoch ${openSig} confirmed but Epoch ${epoch.toBase58()} not readable yet; will resume next cycle`);
  await pushAndFinalize(ctx, acc, plan.items, new Map());
}

interface Plan {
  items: EpochPlanItem[]; // sorted by wallet, amounts > 0, sum = total
  twabTotal: bigint; // Σ TWAB of eligible wallets (open_epoch arg)
}

/** TWAB → exclusions → min-holding filter → pro-rata shares. Deterministic order (sorted by wallet). */
async function computePlan(ctx: PoolCtx, startTs: number, endTs: number, total: bigint): Promise<Plan | null> {
  const { pool } = ctx;
  const events = await getBalanceEvents(pool.dbc_pool, startTs, endTs);
  const priorEvents = await getBalanceEventsBefore(pool.dbc_pool, startTs);
  const allEvents = [...priorEvents, ...events].map((e) => ({ pool: e.pool, wallet: e.wallet, delta: BigInt(e.delta), ts: Number(e.ts) }));

  const twab = computeTwab(allEvents, { start: startTs, end: endTs, exclude: excludedAddresses(pool) });
  if (twab.size === 0) {
    log.debug({ pool: pool.dbc_pool }, "no eligible TWAB balances this epoch");
    return null;
  }
  const eligible = await applyMinHoldingFilter(pool, twab);
  if (eligible.size === 0) {
    log.info({ pool: pool.dbc_pool, holders: twab.size }, "no holder above PAYOUT_MIN_HOLDING_USD; vault carried to the next epoch");
    return null;
  }
  // Filter already applied in USD terms above; computeShares only splits pro-rata (+ rounding dust to the largest holder).
  const shares = computeShares(eligible, total, { minHoldingUsd: 0, priceUsd8: 1n, coinDecimals: 0 });
  const items = [...shares.entries()]
    .filter(([, amount]) => amount > 0n)
    .map(([wallet, amount]) => ({ wallet, amount }))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  if (items.length === 0) return null;
  const twabTotal = [...eligible.values()].reduce((a, b) => a + b, 0n);
  return { items, twabTotal };
}

/**
 * Drops wallets whose TWAB (memecoin base units, 6 dp) is worth less than PAYOUT_MIN_HOLDING_USD at
 * memecoin USD = latest candle close (memecoin in COIN) × COIN USD. Skipped (with a warning) when either
 * price is missing. The threshold is computed in floating point on purpose: it only gates eligibility,
 * never an amount.
 */
async function applyMinHoldingFilter(pool: PoolRow, twab: Map<string, bigint>): Promise<Map<string, bigint>> {
  const minUsd = loadConfig().payoutMinHoldingUsd;
  if (!(minUsd > 0)) return twab;
  const [candle, coin] = await Promise.all([getLatestCandleClose(pool.dbc_pool), getLatestPrice(pool.commodity)]);
  if (!candle || !coin) {
    log.warn(
      { pool: pool.dbc_pool, haveCandle: !!candle, haveCoinPrice: !!coin },
      "min-holding filter SKIPPED: no memecoin candle or COIN price (is apps/indexer candles.ts running?)",
    );
    return twab;
  }
  const memeUsd = Number(candle.close) * (Number(coin.price) / 1e8);
  if (!Number.isFinite(memeUsd) || memeUsd <= 0) {
    log.warn({ pool: pool.dbc_pool, close: candle.close, coinPrice: coin.price }, "min-holding filter SKIPPED: non-positive memecoin price");
    return twab;
  }
  const minBase = BigInt(Math.ceil((minUsd / memeUsd) * 1e6));
  const out = new Map<string, bigint>();
  for (const [wallet, bal] of twab) if (bal >= minBase) out.set(wallet, bal);
  log.debug({ pool: pool.dbc_pool, memeUsd, minBase: minBase.toString(), before: twab.size, after: out.size }, "min-holding filter applied");
  return out;
}

// ---- resume ---------------------------------------------------------------------------------------

async function resumeEpoch(ctx: PoolCtx, acc: EpochAccount): Promise<void> {
  const { pool } = ctx;
  let plan: EpochPlanItem[];
  const progress = await getEpochProgress(pool.dbc_pool, acc.index);
  if (progress && progress.total_amount === acc.totalAmount) {
    plan = progress.plan;
  } else {
    // No persisted plan (opened by a v0.1 keeper, or the db write was lost): recompute over the epoch's own
    // closed window. balance_events for a past window are stable, so this reproduces the original split
    // unless events were ingested late.
    log.warn({ pool: pool.dbc_pool, index: acc.index }, "no persisted plan for epoch; recomputing from TWAB over its window");
    const recomputed = await computePlan(ctx, acc.startTs, acc.endTs, acc.totalAmount);
    plan = recomputed?.items ?? [];
    await saveEpochPlan({
      pool: pool.dbc_pool,
      epoch_index: acc.index,
      epoch_pubkey: epochPdaFor(ctx, acc.index).toBase58(),
      coin_mint: acc.coinMint.toBase58(),
      start_ts: acc.startTs,
      end_ts: acc.endTs,
      total_amount: acc.totalAmount,
      plan,
    });
  }
  await setEpochPhase(pool.dbc_pool, acc.index, "opened");
  await insertEpoch({
    pool: pool.dbc_pool,
    index: acc.index,
    coin_mint: acc.coinMint.toBase58(),
    start_ts: acc.startTs,
    end_ts: acc.endTs,
    total_amount: acc.totalAmount.toString(),
    eligible_holders: plan.length,
    epoch_pubkey: epochPdaFor(ctx, acc.index).toBase58(),
  });

  try {
    const pushed = await reconcilePushed(ctx, acc);
    await pushAndFinalize(ctx, acc, plan, pushed);
  } catch (err) {
    await setEpochError(pool.dbc_pool, acc.index, String(err));
    throw err;
  }
}

/**
 * Wallets already pushed in this epoch. Source of truth is the chain (`Epoch.pushed_amount`); the db
 * `payouts` rows are used when they add up to it, otherwise the epoch's transactions are re-read and
 * their `Payout{kind: 0}` events recorded (covers a crash between a landed push and its db write).
 */
async function reconcilePushed(ctx: PoolCtx, acc: EpochAccount): Promise<Map<string, bigint>> {
  const rows = await getPushedPayouts(ctx.pool.dbc_pool, acc.index);
  const pushed = new Map(rows.map((r) => [r.wallet, r.amount] as [string, bigint]));
  const dbSum = rows.reduce((s, r) => s + r.amount, 0n);
  if (dbSum === acc.pushedAmount) return pushed;

  log.warn({ pool: ctx.pool.dbc_pool, index: acc.index, db: dbSum.toString(), chain: acc.pushedAmount.toString() }, "pushed totals disagree; reading Payout events from chain");
  const epoch = epochPdaFor(ctx, acc.index);
  const sigs = await getConnection().getSignaturesForAddress(epoch, { limit: 1000 }, "confirmed");
  for (const s of sigs.reverse()) {
    if (s.err) continue;
    const events = await parseEvents("distributor", s.signature);
    for (const e of events) {
      if (e.name !== "Payout" && e.name !== "payout") continue;
      const d = e.data;
      const kind = Number(String(d.kind));
      const evEpoch = String((d.epoch as PublicKey | undefined)?.toBase58?.() ?? d.epoch);
      if (kind !== 0 || evEpoch !== epoch.toBase58()) continue;
      const wallet = String((d.wallet as PublicKey | undefined)?.toBase58?.() ?? d.wallet);
      const amount = big(d.amount);
      if (!pushed.has(wallet)) {
        pushed.set(wallet, amount);
        await recordPayout({ pool: ctx.pool.dbc_pool, epoch_index: acc.index, wallet, coin_mint: ctx.coinMint.toBase58(), amount: amount.toString(), kind: 0, sig: s.signature });
      }
    }
  }
  const chainSum = [...pushed.values()].reduce((a, b) => a + b, 0n);
  if (chainSum !== acc.pushedAmount) {
    throw new Error(`cannot reconcile pushes for epoch ${acc.index}: events sum ${chainSum} != Epoch.pushed_amount ${acc.pushedAmount} (manual review)`);
  }
  return pushed;
}

// ---- push + finalize (shared by fresh and resumed epochs) ----------------------------------------------

async function pushAndFinalize(ctx: PoolCtx, acc: EpochAccount, plan: EpochPlanItem[], alreadyPushed: Map<string, bigint>): Promise<void> {
  const { pool } = ctx;
  const connection = getConnection();
  const dist = getProgram("distributor");
  const epoch = epochPdaFor(ctx, acc.index);
  const epochVault = getAssociatedTokenAddressSync(ctx.coinMint, epoch, true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dc: any = await (dist.account as any).distConfig.fetch(ctx.distConfig);
  const pushCap = (acc.totalAmount * BigInt(dc.maxPushPerEpochBps)) / BPS;

  const remaining = plan.filter((p) => p.amount > 0n && !alreadyPushed.has(p.wallet));
  const destAtas = remaining.map((p) => getAssociatedTokenAddressSync(ctx.coinMint, new PublicKey(p.wallet), true));
  const infos = remaining.length > 0 ? await connection.getMultipleAccountsInfo(destAtas) : [];
  const pushable: { wallet: string; amount: bigint; dest: PublicKey }[] = [];
  const merkle: EpochPlanItem[] = [];
  let pushedTotal = acc.pushedAmount;
  remaining.forEach((p, i) => {
    const info = infos[i];
    const existing = info !== null && info !== undefined && info.owner.equals(TOKEN_PROGRAM_ID);
    if (existing && pushedTotal + p.amount <= pushCap) {
      pushable.push({ ...p, dest: destAtas[i] });
      pushedTotal += p.amount;
    } else {
      merkle.push(p);
    }
  });

  for (let i = 0; i < pushable.length; i += PUSH_CHUNK_SIZE) {
    const chunk = pushable.slice(i, i + PUSH_CHUNK_SIZE);
    const pushIx: TransactionInstruction = await dist.methods
      .pushPayouts(chunk.map((c) => ({ wallet: new PublicKey(c.wallet), amount: new BN(c.amount.toString()) })))
      .accountsPartial({ keeper: ctx.keeper, distConfig: ctx.distConfig, epoch, coinMint: ctx.coinMint, epochVault, tokenProgram: TOKEN_PROGRAM_ID })
      .remainingAccounts(chunk.map((c) => ({ pubkey: c.dest, isSigner: false, isWritable: true })))
      .instruction();
    const sig = await sendWithPriority([pushIx]);
    for (const c of chunk) {
      await recordPayout({ pool: pool.dbc_pool, epoch_index: acc.index, wallet: c.wallet, coin_mint: ctx.coinMint.toBase58(), amount: c.amount.toString(), kind: 0, sig });
    }
  }
  await setEpochPhase(pool.dbc_pool, acc.index, "pushed");

  // Merkle root over the remainder (zero root closes an all-push epoch). Sorted → reproducible on resume.
  merkle.sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  const tree = merkle.length > 0 ? buildEpochTree(epoch, merkle.map((m) => ({ wallet: new PublicKey(m.wallet), amount: m.amount }))) : null;
  const root = tree ? tree.root : Buffer.alloc(32);
  const merkleTotal = tree ? tree.total : 0n;
  if (merkleTotal > acc.totalAmount - pushedTotal) {
    throw new Error(`merkle total ${merkleTotal} exceeds remainder ${acc.totalAmount - pushedTotal} for epoch ${acc.index}`);
  }
  const finalizeIx: TransactionInstruction = await dist.methods
    .finalizeEpoch(Array.from(root), new BN(merkleTotal.toString()))
    .accountsPartial({ keeper: ctx.keeper, distConfig: ctx.distConfig, epoch })
    .instruction();
  const finalizeSig = await sendWithPriority([finalizeIx]);
  await writeFinalized(ctx, acc.index, epoch, root.toString("hex"), pushedTotal, tree, finalizeSig);
  log.info(
    { pool: pool.dbc_pool, index: acc.index, pushed: pushedTotal.toString(), merkleTotal: merkleTotal.toString(), claimers: merkle.length },
    "epoch finalized",
  );
}

async function writeFinalized(
  ctx: PoolCtx,
  index: number,
  epoch: PublicKey,
  rootHex: string,
  pushedTotal: bigint,
  tree: ReturnType<typeof buildEpochTree> | null,
  finalizeSig: string | undefined,
): Promise<void> {
  const { pool } = ctx;
  if (tree) {
    await insertMerkleLeaves(
      tree.entries.map((e, i) => ({
        pool: pool.dbc_pool,
        epoch_index: index,
        epoch_pubkey: epoch.toBase58(),
        wallet: new PublicKey(e.wallet).toBase58(),
        coin_mint: ctx.coinMint.toBase58(),
        amount: e.amount.toString(),
        proof: getProof(tree, i).map((b) => b.toString("hex")),
      })),
    );
  }
  await markEpochFinalized(pool.dbc_pool, index, rootHex, pushedTotal.toString(), (tree?.total ?? 0n).toString());
  await setEpochPhase(pool.dbc_pool, index, "finalized", { finalize_sig: finalizeSig, merkle_root: rootHex, last_error: null });
}

/**
 * The chain says finalized but our bookkeeping does not (crash between `finalize_epoch` and the db
 * writes): rebuild the tree from plan − pushed and, if it reproduces the on-chain root, store the leaves.
 */
async function repairFinalizedBookkeeping(ctx: PoolCtx, acc: EpochAccount): Promise<void> {
  const progress = await getEpochProgress(ctx.pool.dbc_pool, acc.index);
  if (!progress || progress.phase === "finalized") return;
  const pushed = await reconcilePushed(ctx, acc);
  const merkle = progress.plan
    .filter((p) => p.amount > 0n && !pushed.has(p.wallet))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  const epoch = epochPdaFor(ctx, acc.index);
  const tree = merkle.length > 0 ? buildEpochTree(epoch, merkle.map((m) => ({ wallet: new PublicKey(m.wallet), amount: m.amount }))) : null;
  const rootHex = tree ? tree.root.toString("hex") : ZERO_ROOT_HEX;
  if (rootHex !== acc.merkleRootHex) {
    const msg = `finalized epoch ${acc.index}: rebuilt root ${rootHex} != on-chain ${acc.merkleRootHex}; merkle_leaves NOT written (manual review)`;
    log.error({ pool: ctx.pool.dbc_pool }, msg);
    await setEpochError(ctx.pool.dbc_pool, acc.index, msg);
    return;
  }
  log.warn({ pool: ctx.pool.dbc_pool, index: acc.index }, "repairing bookkeeping of an epoch finalized on-chain");
  await writeFinalized(ctx, acc.index, epoch, rootHex, acc.pushedAmount, tree, undefined);
}
