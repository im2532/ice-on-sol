/**
 * Fee cycle (CONTRACTS §2, §5): every FEE_CYCLE_INTERVAL, for each registered pool
 *   - not migrated: `fee_router.claim_dbc` (CPI DBC claim_trading_fee(0, u64::MAX) → split)
 *   - migrated:     `fee_router.claim_damm` (CPI cp_amm claim_position_fee → split; base → treasury)
 * when the unclaimed partner fee is worth ≥ $100 (or unknown, for DAMM positions).
 *
 * Account keys are the camelCase of the Rust `ClaimDbc` / `ClaimDamm` field names
 * (programs/fee_router/src/instructions/claim_dbc.rs, claim_damm.rs).
 *
 * // CHECK vs SDK: `DynamicBondingCurveClient.state.getPool` field names (`partnerQuoteFee`,
 * `baseVault`, `quoteVault`, `config`) — the DBC SDK could not be installed in this sandbox.
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DBC_PROGRAM_ID, DAMM_V2_PROGRAM_ID, feeRouter as feeRouterPda, getPoolState, makeDbcClient, meteora } from "@icemarkets/sdk";
import { getConnection, getKeeperKeypair, sendWithPriority } from "../rpc";
import { getProgram, parseEvents, programId } from "../programs";
import { findRouterPositions } from "../positions";
import { getLatestPrice, listAllPools, recordFeeClaim, type PoolRow } from "../db";
import { childLogger } from "../logger";

const log = childLogger("fees");

const CLAIM_THRESHOLD_USD = 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pk = (v: any): PublicKey | null => (v ? (v instanceof PublicKey ? v : new PublicKey(v.toString())) : null);

export async function runFeesCycle(): Promise<void> {
  const keeper = getKeeperKeypair();
  const dbcClient = makeDbcClient({ connection: getConnection() });
  const pools = await listAllPools();
  const positions = pools.some((p) => p.migrated_at) ? await findRouterPositions() : [];

  for (const pool of pools) {
    try {
      if (pool.migrated_at) {
        const pos = positions.find((p) => p.pool.toBase58() === pool.damm_pool);
        if (!pos) {
          log.warn({ pool: pool.dbc_pool, damm: pool.damm_pool }, "migrated pool but no router-owned DAMM position found");
          continue;
        }
        await claimDamm(pool, keeper.publicKey, pos.nftAccount);
      } else {
        await maybeClaimDbc(pool, dbcClient, keeper.publicKey);
      }
    } catch (err) {
      log.error({ pool: pool.dbc_pool, err: String(err) }, "fee claim failed for pool");
    }
  }
}

/** Shared split destinations (fee_router common.rs SplitCtx). */
function splitAccounts(dbcPool: PublicKey, baseMint: PublicKey, quoteMint: PublicKey) {
  const fr = programId("fee_router");
  return {
    config: feeRouterPda.router(fr)[0],
    poolState: feeRouterPda.pool(fr, dbcPool)[0],
    baseMint,
    quoteMint,
    treasuryBase: feeRouterPda.treasury(fr, baseMint)[0],
    routerQuoteRecv: getAssociatedTokenAddressSync(quoteMint, feeRouterPda.router(fr)[0], true),
    holderVault: feeRouterPda.holderVault(fr, dbcPool)[0],
    buybackVault: feeRouterPda.buybackVault(fr, quoteMint)[0],
    treasuryQuote: feeRouterPda.treasury(fr, quoteMint)[0],
    baseTokenProgram: TOKEN_PROGRAM_ID,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
  };
}

async function recordClaimFromEvents(pool: PoolRow, sig: string, source: 0 | 2): Promise<void> {
  const ev = (await parseEvents("fee_router", sig).catch(() => [])).find((e) => e.name === "feesClaimed" || e.name === "FeesClaimed");
  const q = ev ? String(ev.data.quoteAmount ?? ev.data.quote_amount ?? "0") : "0";
  const b = ev ? String(ev.data.baseAmount ?? ev.data.base_amount ?? "0") : "0";
  await recordFeeClaim({ pool: pool.dbc_pool, source, quote_amount: q, base_amount: b });
}

async function maybeClaimDbc(pool: PoolRow, dbcClient: ReturnType<typeof makeDbcClient>, caller: PublicKey): Promise<void> {
  const dbcPool = new PublicKey(pool.dbc_pool);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = (await getPoolState(dbcClient, dbcPool)) as any;
  const unclaimedQuote = BigInt((state?.partnerQuoteFee ?? state?.partner_quote_fee ?? 0).toString());
  const priceRow = await getLatestPrice(pool.commodity);
  const unclaimedUsd = priceRow ? (Number(unclaimedQuote) / 1e6) * (Number(priceRow.price) / 1e8) : 0;
  if (unclaimedUsd < CLAIM_THRESHOLD_USD) return;

  const baseMint = new PublicKey(pool.base_mint);
  const quoteMint = new PublicKey(pool.quote_mint);
  const dbcConfig = pk(state?.config);
  if (!dbcConfig) throw new Error("DBC pool state has no config field (CHECK vs SDK)");

  log.info({ pool: pool.dbc_pool, unclaimedQuote: unclaimedQuote.toString(), unclaimedUsd }, "claim_dbc");
  const ix: TransactionInstruction = await getProgram("fee_router")
    .methods.claimDbc()
    .accountsPartial({
      caller,
      ...splitAccounts(dbcPool, baseMint, quoteMint),
      dbcPoolAuthority: meteora.dbcPoolAuthority(),
      dbcConfig,
      dbcPool,
      baseVault: pk(state?.baseVault) ?? meteora.dbcTokenVault(baseMint, dbcPool),
      quoteVault: pk(state?.quoteVault) ?? meteora.dbcTokenVault(quoteMint, dbcPool),
      dbcEventAuthority: meteora.dbcEventAuthority(),
      dbcProgram: DBC_PROGRAM_ID,
    })
    .instruction();
  const sig = await sendWithPriority([ix]);
  await recordClaimFromEvents(pool, sig, 0);
}

async function claimDamm(pool: PoolRow, caller: PublicKey, positionNftAccount: PublicKey): Promise<void> {
  const dbcPool = new PublicKey(pool.dbc_pool);
  const baseMint = new PublicKey(pool.base_mint);
  const quoteMint = new PublicKey(pool.quote_mint);
  const fr = getProgram("fee_router");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ps: any = await (fr.account as any).poolState.fetch(feeRouterPda.pool(programId("fee_router"), dbcPool)[0]);
  const dammPool: PublicKey = ps.dammPool;

  // Migrated DBC pools: token_a = memecoin (base), token_b = COIN (quote) — see claim_damm.rs.
  log.info({ pool: pool.dbc_pool, dammPool: dammPool.toBase58() }, "claim_damm");
  const ix: TransactionInstruction = await fr.methods
    .claimDamm()
    .accountsPartial({
      caller,
      ...splitAccounts(dbcPool, baseMint, quoteMint),
      dammPoolAuthority: meteora.dammPoolAuthority(),
      dammPool,
      dammPosition: ps.dammPosition,
      tokenAVault: meteora.dammTokenVault(baseMint, dammPool),
      tokenBVault: meteora.dammTokenVault(quoteMint, dammPool),
      positionNftAccount,
      dammEventAuthority: meteora.dammEventAuthority(),
      dammProgram: DAMM_V2_PROGRAM_ID,
    })
    .instruction();
  const sig = await sendWithPriority([ix]);
  await recordClaimFromEvents(pool, sig, 2);
}
