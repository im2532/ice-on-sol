#!/usr/bin/env tsx
/**
 * Post-migration volume: buy a migrated memecoin on its DAMM v2 pool (peg_desk.buy USDC→COIN, then
 * cp-amm swap COIN→MEME) from the command line, so the router-owned LP position accrues fees for
 * fee_router.claim_damm.
 *
 *   pnpm exec tsx scripts/trade-damm.ts --pool <dbcPool> [--usdc 50] [--count 1]
 *
 * Env: RPC_URL, SOLANA_CLUSTER, ADMIN_KEYPAIR_PATH (trader; holds USDC), USDC_MINT_OVERRIDE on localnet, [IDL_DIR].
 * The pool must be a migrated market in deployments/<cluster>.json#markets; the DAMM pool is read from the
 * fee_router PoolState.
 */
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as sdk from "@icemarkets/sdk";
import { usdcMintFor, parseCluster } from "@icemarkets/registry";

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`missing --${name}`);
}
const requireEnv = (n: string): string => { const v = process.env[n]; if (!v) throw new Error(`Missing required env var: ${n}`); return v; };

async function main(): Promise<void> {
  const cluster = parseCluster(process.env.SOLANA_CLUSTER);
  const connection = new Connection(requireEnv("RPC_URL"), "confirmed");
  const trader = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(requireEnv("ADMIN_KEYPAIR_PATH"), "utf8"))));
  const dbcPool = new PublicKey(arg("pool"));
  const usdcHuman = Number(arg("usdc", "50"));
  const count = Number(arg("count", "1"));
  const idlDir = process.env.IDL_DIR ?? path.join(process.cwd(), "target", "idl");
  const depFile = path.join(process.cwd(), "deployments", `${cluster}.json`);
  const dep = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : {};
  const market = (dep.markets ?? []).find((m: { dbcPool: string }) => m.dbcPool === dbcPool.toBase58());
  if (!market) throw new Error("pool not in deployments file (launch-market.ts writes it)");

  const usdcMint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT_OVERRIDE));
  const pegDesk = sdk.createPegDeskClient(connection, trader.publicKey, JSON.parse(readFileSync(path.join(idlDir, "peg_desk.json"), "utf8")));
  const commodity = await pegDesk.fetchCommodityView(market.quote);

  // DAMM pool from fee_router PoolState (written by record_migration).
  const provider = new AnchorProvider(connection, new Wallet(trader), { commitment: "confirmed" });
  const frIdl = JSON.parse(readFileSync(path.join(idlDir, "fee_router.json"), "utf8"));
  const fr = new Program({ ...frIdl, address: sdk.FEE_ROUTER_PROGRAM_ID.toBase58() }, provider);
  const ps: any = await (fr.account as any).poolState.fetch(sdk.feeRouter.pool(sdk.FEE_ROUTER_PROGRAM_ID, dbcPool)[0]);
  if (!ps.migrated) throw new Error("pool is not migrated yet");
  const dammPool = new PublicKey(ps.dammPool);
  const cpAmm = new CpAmm(connection);
  const st: any = await cpAmm.fetchPoolState(dammPool);
  const memeMint = new PublicKey(market.baseMint);

  for (let i = 0; i < count; i++) {
    const oracle = await pegDesk.fetchOracleReading(commodity);
    const usdcIn = BigInt(Math.round(usdcHuman * 1e6));
    const q = pegDesk.quote(commodity, oracle, usdcIn);
    const minCoinOut = sdk.applySlippageDown(q.coinOut, 300n);
    const buyIx = await pegDesk.buyIx({ user: trader.publicKey, commodity, usdcIn, minCoinOut, userUsdcAta: sdk.ata(usdcMint, trader.publicKey) });
    const swapTx = await cpAmm.swap({
      payer: trader.publicKey, pool: dammPool, inputTokenMint: commodity.coinMint, outputTokenMint: memeMint,
      amountIn: new BN(minCoinOut.toString()), minimumAmountOut: new BN(0),
      tokenAMint: st.tokenAMint, tokenBMint: st.tokenBMint, tokenAVault: st.tokenAVault, tokenBVault: st.tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, referralTokenAccount: null,
    });
    const swapIxs = (swapTx as Transaction).instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      pegDesk.createUserCoinAtaIx(trader.publicKey, trader.publicKey, commodity.coinMint),
      buyIx,
      ...swapIxs,
    );
    tx.feePayer = trader.publicKey;
    const bh = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.sign(trader);
    const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) throw new Error(`damm buy ${i + 1}/${count} failed: ${JSON.stringify(conf.value.err)} (${sig})`);
    console.log(`damm buy ${i + 1}/${count}: $${usdcHuman} USDC -> ${market.quote} -> ${market.symbol} on DAMM ${dammPool.toBase58().slice(0, 8)}  ${sig}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
